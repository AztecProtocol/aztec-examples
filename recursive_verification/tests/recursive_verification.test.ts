import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import type { FieldLike } from "@aztec/aztec.js/abi"
import { TxStatus } from "@aztec/aztec.js/tx"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { TestWallet } from "@aztec/test-wallet/server"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { getPXEConfig } from "@aztec/pxe/config"
import { ValueNotEqualContract } from '../contract/artifacts/ValueNotEqual'
import { getSponsoredFPCInstance } from '../scripts/sponsored_fpc'
import data from '../data.json'

const NODE_URL = 'http://localhost:8080'

// Test timeout - proof generation/verification can take several minutes
const TEST_TIMEOUT = 600000 // 10 minutes

describe("Recursive Verification", () => {
  let testWallet: TestWallet
  let ownerAddress: AztecAddress
  let user1Address: AztecAddress
  let valueNotEqualContract: ValueNotEqualContract
  let sponsoredPaymentMethod: SponsoredFeePaymentMethod

  beforeAll(async () => {
    // Setup TestWallet with PXE
    console.log(`Connecting to Aztec Node at ${NODE_URL}`)
    const aztecNode = await createAztecNodeClient(NODE_URL)

    // Setup sponsored FPC for fee payment
    const sponsoredFPC = await getSponsoredFPCInstance()
    sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address)

    // Create PXE config and TestWallet
    const config = getPXEConfig()
    // TODO: this hangs when set to true, need to debug 
    config.proverEnabled = false

    testWallet = await TestWallet.create(aztecNode, config)

    // Register the sponsored FPC contract
    await testWallet.registerContract({
      instance: sponsoredFPC,
      artifact: SponsoredFPCContract.artifact,
    })
    console.log('TestWallet configured')

    // Create owner account
    console.log('Creating owner account...')
    const ownerAccountManager = await testWallet.createAccount()
    console.log('Getting deploy method...')
    const ownerDeployMethod = await ownerAccountManager.getDeployMethod()
    console.log('Deploying account (this may take a while for proof generation)...')
    const txReceipt = await ownerDeployMethod.send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }).wait()
    console.log(`Account deployed! Tx hash: ${txReceipt.txHash.toString()}`)

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

    valueNotEqualContract = await ValueNotEqualContract.deploy(
      testWallet,
      initialValue,
      ownerAddress,
      data.vkHash as unknown as FieldLike
    )
      .send(sendOpts)
      .deployed()

    expect(valueNotEqualContract.address).toBeDefined()
    expect(valueNotEqualContract.address.toString()).not.toBe("")

    console.log("Contract deployed at address:", valueNotEqualContract.address.toString())
  }, TEST_TIMEOUT)

  test("should verify proof and increment counter", async () => {
    const sendOpts = {
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    // Call increment with proof data
    const tx = await valueNotEqualContract.methods.increment(
      ownerAddress,
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
    ).send(sendOpts).wait()

    expect(tx).toBeDefined()
    expect(tx.txHash).toBeDefined()
    expect(tx.status).toBe(TxStatus.SUCCESS)

    console.log(`Transaction hash: ${tx.txHash.toString()}`)
    console.log(`Transaction status: ${tx.status}`)
  }, TEST_TIMEOUT)

  test("should read incremented counter value", async () => {
    const counterValue = await valueNotEqualContract.methods.get_counter(
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
    const tx = await valueNotEqualContract.methods.increment(
      ownerAddress,
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
    ).send(sendOpts).wait()

    expect(tx).toBeDefined()
    expect(tx.txHash).toBeDefined()
    expect(tx.status).toBe(TxStatus.SUCCESS)

    // Check counter value is now 12
    const counterValue = await valueNotEqualContract.methods.get_counter(
      ownerAddress
    ).simulate({ from: ownerAddress })

    expect(counterValue).toBe(12n)

    console.log(`Counter value after second increment: ${counterValue}`)
  }, TEST_TIMEOUT)

  test("should maintain separate counters for different users", async () => {
    const initialValue = 5

    // Create user1 account
    const user1AccountManager = await testWallet.createAccount()
    const user1DeployMethod = await user1AccountManager.getDeployMethod()
    await user1DeployMethod
      .send({
        from: AztecAddress.ZERO,
        fee: { paymentMethod: sponsoredPaymentMethod },
      })
      .deployed()

    const accounts = await testWallet.getAccounts()
    user1Address = accounts[1].item

    const sendOpts = {
      from: user1Address,
      fee: { paymentMethod: sponsoredPaymentMethod },
    }

    // Deploy a new contract instance for user1
    const user1Contract = await ValueNotEqualContract.deploy(
      testWallet,
      initialValue,
      user1Address,
      data.vkHash as unknown as FieldLike
    )
      .send(sendOpts)
      .deployed()

    // Increment user1's counter
    await user1Contract.methods.increment(
      user1Address,
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
    ).send(sendOpts).wait()

    // Check user1's counter
    const user1Counter = await user1Contract.methods.get_counter(
      user1Address
    ).simulate({ from: user1Address })

    expect(user1Counter).toBe(6n) // 5 + 1

    console.log(`User1 counter value: ${user1Counter}`)
  }, TEST_TIMEOUT)

})