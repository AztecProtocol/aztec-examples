import { describe, expect, test, beforeAll, afterAll } from "vitest"
import type { FieldLike } from "@aztec/aztec.js/abi"
import { TxExecutionResult } from "@aztec/aztec.js/tx"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { NO_FROM } from "@aztec/aztec.js/account"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContract } from "@aztec/noir-contracts.js/Token"
import { EmailClaimContract } from '../contract/artifacts/EmailClaim'
import { getSponsoredFPCInstance } from '../scripts/sponsored_fpc'
import data from '../data.json'

const NODE_URL = 'http://localhost:8080'
const TEST_TIMEOUT = 1200000 // 20 minutes

// Maximum email age in seconds. Set very large for testing with old test email (April 2024).
// In production, use a much shorter window (e.g., 15 * 60 for 15 minutes).
const MAX_EMAIL_AGE = 100 * 365 * 24 * 60 * 60
const DEPOSIT_AMOUNT = 500n
const CLAIM_AMOUNT = 100n

describe("ZKEmail Offchain Transfer", () => {
  let testWallet: EmbeddedWallet
  let bobAddress: AztecAddress
  let carolAddress: AztecAddress
  let token: TokenContract
  let emailClaim: EmailClaimContract
  let sponsoredPaymentMethod: SponsoredFeePaymentMethod

  // Public inputs from proof
  const trustedDkimKeyHash0 = data.publicInputs[0] as unknown as FieldLike
  const trustedDkimKeyHash1 = data.publicInputs[1] as unknown as FieldLike
  const fromAddressHash = data.publicInputs[3] as unknown as FieldLike
  const toAddressHash = data.publicInputs[4] as unknown as FieldLike
  const intentHash = data.publicInputs[5] as unknown as FieldLike

  const sendOpts = (from: AztecAddress) => ({
    from,
    fee: { paymentMethod: sponsoredPaymentMethod },
  })

  beforeAll(async () => {
    console.log(`Connecting to Aztec Node at ${NODE_URL}`)
    const aztecNode = await createAztecNodeClient(NODE_URL)
    const sponsoredFPC = await getSponsoredFPCInstance()
    sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address)

    testWallet = await EmbeddedWallet.create(aztecNode, {
      pxeConfig: { proverEnabled: true },
      ephemeral: true,
    })
    await testWallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact)

    // Create Bob and Carol accounts
    console.log('Creating Bob account...')
    const bobAccountManager = await testWallet.createSchnorrAccount(Fr.random(), Fr.random())
    await (await bobAccountManager.getDeployMethod()).send({
      from: NO_FROM,
      fee: { paymentMethod: sponsoredPaymentMethod },
    })

    console.log('Creating Carol account...')
    const carolAccountManager = await testWallet.createSchnorrAccount(Fr.random(), Fr.random())
    await (await carolAccountManager.getDeployMethod()).send({
      from: NO_FROM,
      fee: { paymentMethod: sponsoredPaymentMethod },
    })

    const accounts = await testWallet.getAccounts()
    bobAddress = accounts[0].item
    carolAddress = accounts[1].item
    console.log(`Bob:   ${bobAddress}`)
    console.log(`Carol: ${carolAddress}`)
  }, TEST_TIMEOUT)

  afterAll(async () => {
    if (testWallet) {
      await testWallet.stop()
    }
  })

  test("should deploy Token and EmailClaim contracts", async () => {
    // Deploy token
    ;({ contract: token } = await TokenContract.deploy(
      testWallet,
      bobAddress,
      "TestToken",
      "TT",
      18,
    ).send(sendOpts(bobAddress)))
    expect(token.address.toString()).not.toBe("")

    // Mint to Bob
    await token.methods.mint_to_public(bobAddress, DEPOSIT_AMOUNT).send(sendOpts(bobAddress))

    // Deploy EmailClaim
    ;({ contract: emailClaim } = await EmailClaimContract.deploy(
      testWallet,
      token.address,
      data.vkHash as unknown as FieldLike,
      trustedDkimKeyHash0,
      trustedDkimKeyHash1,
      MAX_EMAIL_AGE,
    ).send(sendOpts(bobAddress)))
    expect(emailClaim.address.toString()).not.toBe("")

    console.log(`Token: ${token.address}`)
    console.log(`EmailClaim: ${emailClaim.address}`)
  }, TEST_TIMEOUT)

  test("should allow Bob to deposit tokens", async () => {
    const authwitNonce = Fr.random()
    await testWallet.setPublicAuthWit(
      {
        caller: emailClaim.address,
        action: token.methods.transfer_in_public(bobAddress, emailClaim.address, DEPOSIT_AMOUNT, authwitNonce),
      },
      true,
    ).send(sendOpts(bobAddress))

    await emailClaim.methods.deposit(
      fromAddressHash,
      DEPOSIT_AMOUNT,
      authwitNonce,
    ).send(sendOpts(bobAddress))

    const balance = (await emailClaim.methods.get_deposit_balance(fromAddressHash).simulate({ from: bobAddress })).result
    expect(balance).toBe(DEPOSIT_AMOUNT)
    console.log(`Bob deposited ${DEPOSIT_AMOUNT}, balance: ${balance}`)
  }, TEST_TIMEOUT)

  test("should allow Carol to create a claim and complete it with email proof", async () => {
    // Carol creates partial note
    const { result: partialNote } = await emailClaim.methods.create_claim().send(sendOpts(carolAddress))
    expect(partialNote).toBeDefined()
    console.log(`Partial note: ${partialNote}`)

    // Carol completes claim with email proof
    const { receipt: tx } = await emailClaim.methods.claim_with_email(
      toAddressHash,
      intentHash,
      partialNote,
      CLAIM_AMOUNT,
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
    ).send(sendOpts(carolAddress))
    expect(tx.executionResult).toBe(TxExecutionResult.SUCCESS)
    console.log(`Claim tx: ${tx.txHash}`)
  }, TEST_TIMEOUT)

  test("should reflect correct balances after claim", async () => {
    const depositAfter = (await emailClaim.methods.get_deposit_balance(fromAddressHash).simulate({ from: bobAddress })).result
    expect(depositAfter).toBe(DEPOSIT_AMOUNT - CLAIM_AMOUNT)
    console.log(`Bob's deposit after claim: ${depositAfter}`)
  }, TEST_TIMEOUT)

  test("should reject replay of same email proof", async () => {
    const { result: partialNote2 } = await emailClaim.methods.create_claim().send(sendOpts(carolAddress))

    await expect(
      emailClaim.methods.claim_with_email(
        toAddressHash,
        intentHash,
        partialNote2,
        CLAIM_AMOUNT,
        data.vkAsFields as unknown as FieldLike[],
        data.proofAsFields as unknown as FieldLike[],
        data.publicInputs as unknown as FieldLike[],
      ).send(sendOpts(carolAddress))
    ).rejects.toThrow()
    console.log("Replay correctly rejected -- nullifier prevents reuse")
  }, TEST_TIMEOUT)
})
