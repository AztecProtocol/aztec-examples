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

describe("ZKEmail Verification", () => {
  let testWallet: EmbeddedWallet
  let ownerAddress: AztecAddress
  let zkEmailVerifierContract: ZKEmailVerifierContract
  let sponsoredPaymentMethod: SponsoredFeePaymentMethod

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

  test("should deploy ZKEmailVerifier contract", async () => {
    const sendOpts = {
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    ;({ contract: zkEmailVerifierContract } = await ZKEmailVerifierContract.deploy(
      testWallet,
      ownerAddress,
      data.vkHash as unknown as FieldLike
    )
      .send(sendOpts))

    expect(zkEmailVerifierContract.address).toBeDefined()
    expect(zkEmailVerifierContract.address.toString()).not.toBe("")

    console.log("Contract deployed at address:", zkEmailVerifierContract.address.toString())
  }, TEST_TIMEOUT)

  test("should verify email proof and increment verification count", async () => {
    const sendOpts = {
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    console.log("Submitting email proof for on-chain verification...")
    const { receipt: tx } = await zkEmailVerifierContract.methods.verify_email(
      ownerAddress,
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
    ).send(sendOpts)
    expect(tx).toBeDefined()
    expect(tx.txHash).toBeDefined()
    expect(tx.executionResult).toBe(TxExecutionResult.SUCCESS)

    console.log(`Transaction hash: ${tx.txHash.toString()}`)
    console.log(`Transaction status: ${tx.status}`)
  }, TEST_TIMEOUT)

  test("should read verification count", async () => {
    const { result: counterValue } = await zkEmailVerifierContract.methods.get_verification_count(
      ownerAddress
    ).simulate({ from: ownerAddress })

    expect(counterValue).toBe(1n)
    console.log(`Verification count: ${counterValue}`)
  }, TEST_TIMEOUT)

  test("should verify same proof again and increment count to 2", async () => {
    const sendOpts = {
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    const { receipt: tx } = await zkEmailVerifierContract.methods.verify_email(
      ownerAddress,
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
    ).send(sendOpts)
    expect(tx).toBeDefined()
    expect(tx.executionResult).toBe(TxExecutionResult.SUCCESS)

    const { result: counterValue } = await zkEmailVerifierContract.methods.get_verification_count(
      ownerAddress
    ).simulate({ from: ownerAddress })

    expect(counterValue).toBe(2n)
    console.log(`Verification count after second proof: ${counterValue}`)
  }, TEST_TIMEOUT)
})
