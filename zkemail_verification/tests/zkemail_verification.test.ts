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
import { ZKEmailVerifierContract } from '../contract/artifacts/ZKEmailVerifier'
import { getSponsoredFPCInstance } from '../scripts/sponsored_fpc'
import data from '../data.json'

const NODE_URL = 'http://localhost:8080'
const TEST_TIMEOUT = 1200000 // 20 minutes

// Maximum email age in seconds. Set very large for testing with old test email (April 2024).
// In production, use a much shorter window (e.g., 15 * 60 for 15 minutes).
const MAX_EMAIL_AGE = 100 * 365 * 24 * 60 * 60;

describe("ZKEmail Verification", () => {
  let testWallet: EmbeddedWallet
  let ownerAddress: AztecAddress
  let zkEmailVerifierContract: ZKEmailVerifierContract
  let sponsoredPaymentMethod: SponsoredFeePaymentMethod

  // Public inputs from proof:
  //   [0] = trusted DKIM pubkey hash (modulus)
  //   [1] = trusted DKIM pubkey hash (redc)
  //   [3] = to_address_hash (authorized email hash)
  //   [4] = intent_hash (subject hash)
  const trustedDkimKeyHash0 = data.publicInputs[0] as unknown as FieldLike
  const trustedDkimKeyHash1 = data.publicInputs[1] as unknown as FieldLike
  const authorizedEmailHash = data.publicInputs[3] as unknown as FieldLike
  const intentHash = data.publicInputs[4] as unknown as FieldLike

  beforeAll(async () => {
    console.log(`Connecting to Aztec Node at ${NODE_URL}`)
    const aztecNode = await createAztecNodeClient(NODE_URL)

    const sponsoredFPC = await getSponsoredFPCInstance()
    sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address)

    // Create EmbeddedWallet with proverEnabled: true for real proof verification
    testWallet = await EmbeddedWallet.create(aztecNode, {
      pxeConfig: { proverEnabled: true },
      ephemeral: true,
    })

    await testWallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact)
    console.log('EmbeddedWallet configured with proverEnabled: true')

    console.log('Creating owner account...')
    const ownerAccountManager = await testWallet.createSchnorrAccount(Fr.random(), Fr.random())
    const ownerDeployMethod = await ownerAccountManager.getDeployMethod()
    console.log('Deploying account (this may take a while with real proof generation)...')
    await ownerDeployMethod.send({
      from: NO_FROM,
      fee: { paymentMethod: sponsoredPaymentMethod },
    })
    console.log('Account deployed!')

    const accounts = await testWallet.getAccounts()
    ownerAddress = accounts[0].item
    console.info('Owner address:', ownerAddress.toString())
  }, TEST_TIMEOUT)

  afterAll(async () => {
    if (testWallet) {
      await testWallet.stop()
    }
  })

  test("should deploy ZKEmailVerifier contract with authorized email and max age", async () => {
    const sendOpts = {
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    ;({ contract: zkEmailVerifierContract } = await ZKEmailVerifierContract.deploy(
      testWallet,
      data.vkHash as unknown as FieldLike,
      trustedDkimKeyHash0,
      trustedDkimKeyHash1,
      authorizedEmailHash,
      MAX_EMAIL_AGE,
    )
      .send(sendOpts))

    expect(zkEmailVerifierContract.address).toBeDefined()
    expect(zkEmailVerifierContract.address.toString()).not.toBe("")

    console.log("Contract deployed at address:", zkEmailVerifierContract.address.toString())
  }, TEST_TIMEOUT)

  test("should verify email proof with correct intent and recipient", async () => {
    const sendOpts = {
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    console.log("Submitting email proof for on-chain verification...")
    const { receipt: tx } = await zkEmailVerifierContract.methods.verify_email(
      intentHash,
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
    ).send(sendOpts)
    expect(tx).toBeDefined()
    expect(tx.txHash).toBeDefined()
    expect(tx.executionResult).toBe(TxExecutionResult.SUCCESS)

    console.log(`Transaction hash: ${tx.txHash.toString()}`)
    console.log(`Transaction status: ${tx.status}`)
    console.log("Email proof verified — nullifier pushed, timestamp checked")
  }, TEST_TIMEOUT)

  test("should reject reuse of the same email proof (nullifier prevents replay)", async () => {
    const sendOpts = {
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    console.log("Attempting to reuse the same email proof (should fail due to duplicate nullifier)...")
    await expect(
      zkEmailVerifierContract.methods.verify_email(
        intentHash,
        data.vkAsFields as unknown as FieldLike[],
        data.proofAsFields as unknown as FieldLike[],
        data.publicInputs as unknown as FieldLike[],
      ).send(sendOpts)
    ).rejects.toThrow()

    console.log("Replay correctly rejected — email nullifier prevents reuse")
  }, TEST_TIMEOUT)

  test("should reject email proof with wrong intent hash", async () => {
    const sendOpts = {
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    const wrongIntentHash = Fr.random() as unknown as FieldLike

    console.log("Submitting proof with wrong intent hash (should fail)...")
    await expect(
      zkEmailVerifierContract.methods.verify_email(
        wrongIntentHash,
        data.vkAsFields as unknown as FieldLike[],
        data.proofAsFields as unknown as FieldLike[],
        data.publicInputs as unknown as FieldLike[],
      ).send(sendOpts)
    ).rejects.toThrow()

    console.log("Wrong intent hash correctly rejected")
  }, TEST_TIMEOUT)

  test("should read stored authorized email hash", async () => {
    const { result: storedHash } = await zkEmailVerifierContract.methods.get_authorized_email_hash()
      .simulate({ from: ownerAddress })

    expect(storedHash).toBe(BigInt(data.publicInputs[3]))
    console.log(`Stored authorized email hash: ${storedHash}`)
  }, TEST_TIMEOUT)
})
