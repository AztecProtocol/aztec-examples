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
import { ValueNotEqualContract } from '../contract/artifacts/ValueNotEqual'
import { getSponsoredFPCInstance } from '../scripts/sponsored_fpc'
import data from '../data.json'

const NODE_URL = 'http://localhost:8080'

// Test timeout - proof generation/verification can take several minutes
const TEST_TIMEOUT = 600000 // 10 minutes

describe("Recursive Verification", () => {
  let testWallet: EmbeddedWallet
  let ownerAddress: AztecAddress
  let user1Address: AztecAddress
  let valueNotEqualContract: ValueNotEqualContract
  let sponsoredPaymentMethod: SponsoredFeePaymentMethod

  beforeAll(async () => {
    // Setup EmbeddedWallet
    console.log(`Connecting to Aztec Node at ${NODE_URL}`)
    const aztecNode = await createAztecNodeClient(NODE_URL)

    // Setup sponsored FPC for fee payment
    const sponsoredFPC = await getSponsoredFPCInstance()
    sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address)

    // Create EmbeddedWallet
    testWallet = await EmbeddedWallet.create(aztecNode, { ephemeral: true })

    // Register the sponsored FPC contract
    await testWallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact)
    console.log('EmbeddedWallet configured')

    // Create owner account
    console.log('Creating owner account...')
    const ownerAccountManager = await testWallet.createSchnorrAccount(Fr.random(), Fr.random())
    console.log('Getting deploy method...')
    const ownerDeployMethod = await ownerAccountManager.getDeployMethod()
    console.log('Deploying account (this may take a while for proof generation)...')
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

  test("should deploy ValueNotEqual contract", async () => {
    const initialValue = 10

    const sendOpts = {
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    ;({ contract: valueNotEqualContract } = await ValueNotEqualContract.deploy(
      testWallet,
      initialValue,
      ownerAddress,
      data.vkHash as unknown as FieldLike
    )
      .send(sendOpts))
      
    expect(valueNotEqualContract.address).toBeDefined()
    expect(valueNotEqualContract.address.toString()).not.toBe("")

    console.log("Contract deployed at address:", valueNotEqualContract.address.toString())
  }, TEST_TIMEOUT)

  test("should verify proof and increment counter", async () => {
    const sendOpts = {
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    // Call increment with proof data (vk_hash is read from storage)
    const { receipt: tx } = await valueNotEqualContract.methods.increment(
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

  test("should read incremented counter value", async () => {
    const { result: counterValue } = await valueNotEqualContract.methods.get_counter(
      ownerAddress
    ).simulate({ from: ownerAddress })

    // Initial value was 10, after increment should be 11
    expect(counterValue).toBe(11n)

    console.log(`Counter value after increment: ${counterValue}`)
  }, TEST_TIMEOUT)

  test("should verify proof and increment counter again", async () => {
    const sendOpts = {
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    // Second increment to verify the contract works multiple times
    const { receipt: tx } = await valueNotEqualContract.methods.increment(
      ownerAddress,
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
    ).send(sendOpts)
    expect(tx).toBeDefined()
    expect(tx.txHash).toBeDefined()
    expect(tx.executionResult).toBe(TxExecutionResult.SUCCESS)

    // Check counter value is now 12
    const { result: counterValue } = await valueNotEqualContract.methods.get_counter(
      ownerAddress
    ).simulate({ from: ownerAddress })

    expect(counterValue).toBe(12n)

    console.log(`Counter value after second increment: ${counterValue}`)
  }, TEST_TIMEOUT)

  test("should maintain separate counters for different users", async () => {
    const initialValue = 5

    // Create user1 account
    const user1AccountManager = await testWallet.createSchnorrAccount(Fr.random(), Fr.random())
    const user1DeployMethod = await user1AccountManager.getDeployMethod()
    await user1DeployMethod
      .send({
        from: NO_FROM,
        fee: { paymentMethod: sponsoredPaymentMethod },
      })
      
    const accounts = await testWallet.getAccounts()
    user1Address = accounts[1].item

    const sendOpts = {
      from: user1Address,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    // Deploy a new contract instance for user1
    const { contract: user1Contract } = await ValueNotEqualContract.deploy(
      testWallet,
      initialValue,
      user1Address,
      data.vkHash as unknown as FieldLike
    )
      .send(sendOpts)
      
    // Increment user1's counter
    await user1Contract.methods.increment(
      user1Address,
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
    ).send(sendOpts)
    // Check user1's counter
    const { result: user1Counter } = await user1Contract.methods.get_counter(
      user1Address
    ).simulate({ from: user1Address })

    expect(user1Counter).toBe(6n) // 5 + 1

    console.log(`User1 counter value: ${user1Counter}`)
  }, TEST_TIMEOUT)

})