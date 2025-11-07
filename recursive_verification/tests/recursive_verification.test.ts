import { describe, expect, test, beforeAll } from "bun:test"
import { AccountWalletWithSecretKey, Contract, createPXEClient, waitForPXE, type FieldLike, type PXE, TxStatus } from "@aztec/aztec.js"
import { getInitialTestAccountsWallets } from '@aztec/accounts/testing'
import { ValueNotEqualContract, ValueNotEqualContractArtifact } from '../contract/artifacts/ValueNotEqual'
import data from '../data.json'

const PXE_URL = 'http://localhost:8080'

// Test timeout - proof verification can take some time
const TEST_TIMEOUT = 60000 // 60 seconds

describe("Recursive Verification", () => {
  let pxe: PXE
  let owner: AccountWalletWithSecretKey
  let user1: AccountWalletWithSecretKey
  let user2: AccountWalletWithSecretKey
  let valueNotEqualContract: ValueNotEqualContract

  beforeAll(async () => {
    // Setup PXE client
    console.log(`Connecting to PXE at ${PXE_URL}`)
    pxe = await createPXEClient(PXE_URL)
    await waitForPXE(pxe)
    console.log('PXE client connected')

    // Setup wallets
    const wallets = await getInitialTestAccountsWallets(pxe)
    owner = wallets[0]
    user1 = wallets[1]
    user2 = wallets[2]

    console.log('Test wallets configured')
    console.info('Owner address:', owner.getAddress().toString())
    console.info('User1 address:', user1.getAddress().toString())
    console.info('User2 address:', user2.getAddress().toString())
  }, TEST_TIMEOUT)

  test("should deploy ValueNotEqual contract", async () => {
    const initialValue = 10

    valueNotEqualContract = await Contract.deploy(
      owner,
      ValueNotEqualContractArtifact,
      [initialValue, owner.getAddress()],
      'initialize'
    ).send({ from: owner.getAddress() }).deployed() as ValueNotEqualContract

    expect(valueNotEqualContract.address).toBeDefined()
    expect(valueNotEqualContract.address.toString()).not.toBe("")

    console.log("Contract deployed at address:", valueNotEqualContract.address.toString())
  }, TEST_TIMEOUT)

  test("should verify proof and increment counter", async () => {
    // Call increment with proof data
    const tx = await valueNotEqualContract.methods.increment(
      owner.getAddress(),
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
      data.vkHash as unknown as FieldLike,
    ).send({ from: owner.getAddress() }).wait()

    expect(tx).toBeDefined()
    expect(tx.txHash).toBeDefined()
    expect(tx.status).toBe(TxStatus.SUCCESS)

    console.log(`Transaction hash: ${tx.txHash.toString()}`)
    console.log(`Transaction status: ${tx.status}`)
  }, TEST_TIMEOUT)

  test("should read incremented counter value", async () => {
    const counterValue = await valueNotEqualContract.methods.get_counter(
      owner.getAddress()
    ).simulate({ from: owner.getAddress() })

    // Initial value was 10, after increment should be 11
    expect(counterValue).toBe(11n)

    console.log(`Counter value after increment: ${counterValue}`)
  }, TEST_TIMEOUT)

  test("should verify proof and increment counter again", async () => {
    // Second increment to verify the contract works multiple times
    const tx = await valueNotEqualContract.methods.increment(
      owner.getAddress(),
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
      data.vkHash as unknown as FieldLike
    ).send({ from: owner.getAddress() }).wait()

    expect(tx).toBeDefined()
    expect(tx.txHash).toBeDefined()
    expect(tx.status).toBe(TxStatus.SUCCESS)

    // Check counter value is now 12
    const counterValue = await valueNotEqualContract.methods.get_counter(
      owner.getAddress()
    ).simulate({ from: owner.getAddress() })

    expect(counterValue).toBe(12n)

    console.log(`Counter value after second increment: ${counterValue}`)
  }, TEST_TIMEOUT)

  test("should maintain separate counters for different users", async () => {
    const initialValue = 5

    // Deploy a new contract instance for user1
    const user1Contract = await Contract.deploy(
      user1,
      ValueNotEqualContractArtifact,
      [initialValue, user1.getAddress()],
      'initialize'
    ).send({ from: user1.getAddress() }).deployed() as ValueNotEqualContract

    // Increment user1's counter
    await user1Contract.methods.increment(
      user1.getAddress(),
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
      data.vkHash as unknown as FieldLike
    ).send({ from: user1.getAddress() }).wait()

    // Check user1's counter
    const user1Counter = await user1Contract.methods.get_counter(
      user1.getAddress()
    ).simulate({ from: user1.getAddress() })

    expect(user1Counter).toBe(6n) // 5 + 1

    console.log(`User1 counter value: ${user1Counter}`)
  }, TEST_TIMEOUT)

})