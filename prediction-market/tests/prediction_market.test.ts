import { describe, expect, test, beforeAll } from "@jest/globals"
import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node'
import { AztecAddress } from '@aztec/aztec.js/addresses'
import { getInitialTestAccountsData } from '@aztec/accounts/testing'
import { TestWallet } from '@aztec/test-wallet/server'
import type { TestWallet as TestWalletType } from '@aztec/test-wallet/server'
import { PredictionMarketContract, PredictionMarketContractArtifact } from '../artifacts/PredictionMarket.js'

const NODE_URL = 'http://localhost:8080'
const TEST_TIMEOUT = 120000 // 120 seconds (private txs take longer)

// Initial liquidity for tests
const INITIAL_LIQUIDITY = 10000n
// Price precision used in the contract
const PRICE_PRECISION = 1_000_000n

describe("Prediction Market Contract - Full Privacy", () => {
  let wallet: TestWalletType
  let adminAddress: AztecAddress
  let aliceAddress: AztecAddress
  let bobAddress: AztecAddress
  let market: PredictionMarketContract

  beforeAll(async () => {
    console.log(`Connecting to Aztec node at ${NODE_URL}`)
    const aztecNode = await createAztecNodeClient(NODE_URL)
    await waitForNode(aztecNode)
    console.log('Aztec node connected')

    // Create TestWallet using server version
    wallet = await TestWallet.create(aztecNode, { dataDirectory: 'pxe-test-data' })
    console.log('TestWallet created')

    // Get test account data
    const accountsData = await getInitialTestAccountsData()

    // Create accounts using the wallet
    const adminAccount = await wallet.createSchnorrAccount(
      accountsData[0].secret,
      accountsData[0].salt,
      accountsData[0].signingKey
    )
    adminAddress = adminAccount.address

    const aliceAccount = await wallet.createSchnorrAccount(
      accountsData[1].secret,
      accountsData[1].salt,
      accountsData[1].signingKey
    )
    aliceAddress = aliceAccount.address

    const bobAccount = await wallet.createSchnorrAccount(
      accountsData[2].secret,
      accountsData[2].salt,
      accountsData[2].signingKey
    )
    bobAddress = bobAccount.address

    console.log('Test accounts configured')
    console.info('Admin address:', adminAddress.toString())
    console.info('Alice address:', aliceAddress.toString())
    console.info('Bob address:', bobAddress.toString())
  }, TEST_TIMEOUT)

  test("should deploy prediction market contract", async () => {
    market = await PredictionMarketContract.deploy(
      wallet,
      adminAddress,
      INITIAL_LIQUIDITY
    ).send({ from: adminAddress }).deployed()

    expect(market.address).toBeDefined()
    console.log("Contract deployed at address:", market.address.toString())
  }, TEST_TIMEOUT)

  test("should have initial 50/50 prices", async () => {
    const yesPrice = await market.methods.get_price(true).simulate({ from: adminAddress })
    const noPrice = await market.methods.get_price(false).simulate({ from: adminAddress })

    expect(yesPrice).toBe(PRICE_PRECISION / 2n)
    expect(noPrice).toBe(PRICE_PRECISION / 2n)

    console.log(`YES price: ${Number(yesPrice) / Number(PRICE_PRECISION) * 100}%`)
    console.log(`NO price: ${Number(noPrice) / Number(PRICE_PRECISION) * 100}%`)
  }, TEST_TIMEOUT)

  test("alice should be able to deposit collateral PRIVATELY", async () => {
    const depositAmount = 2000n

    // deposit() is now a PRIVATE function - creates private collateral notes
    const tx = await market.methods.deposit(depositAmount)
      .send({ from: aliceAddress }).wait()

    expect(tx.status).toBe('success')

    // Collateral balance is now private (sums private notes)
    const balance = await market.methods.get_collateral_balance(aliceAddress).simulate({ from: aliceAddress })
    expect(balance).toBe(depositAmount)

    console.log(`Alice deposited ${depositAmount} PRIVATELY, balance: ${balance}`)
  }, TEST_TIMEOUT)

  test("alice should be able to buy YES tokens with FULL PRIVACY", async () => {
    const buyAmount = 500n
    const minShares = 900n

    // buy_outcome consumes private collateral, creates partial note for shares
    // The public function does NOT receive Alice's address - FULL PRIVACY!
    const tx = await market.methods.buy_outcome(
      true, // is_yes
      buyAmount,
      minShares,
    ).send({ from: aliceAddress }).wait()

    expect(tx.status).toBe('success')
    console.log("Alice bought YES with FULL PRIVACY (public function doesn't know who)")

    // Check private collateral was deducted
    const collateralBalance = await market.methods.get_collateral_balance(aliceAddress).simulate({ from: aliceAddress })
    expect(collateralBalance).toBe(1500n) // 2000 - 500

    // Check private YES balance
    const yesBalance = await market.methods.get_yes_balance(aliceAddress).simulate({ from: aliceAddress })
    expect(yesBalance).toBeGreaterThanOrEqual(minShares)

    console.log(`Alice's private collateral: ${collateralBalance}`)
    console.log(`Alice's private YES balance: ${yesBalance}`)
  }, TEST_TIMEOUT)

  test("YES price should have increased after alice's purchase", async () => {
    const yesPrice = await market.methods.get_price(true).simulate({ from: adminAddress })
    const noPrice = await market.methods.get_price(false).simulate({ from: adminAddress })

    expect(yesPrice).toBeGreaterThan(PRICE_PRECISION / 2n)
    expect(noPrice).toBeLessThan(PRICE_PRECISION / 2n)
    // Allow for small rounding error (integer division)
    const priceSum = yesPrice + noPrice
    expect(priceSum).toBeGreaterThanOrEqual(PRICE_PRECISION - 1n)
    expect(priceSum).toBeLessThanOrEqual(PRICE_PRECISION)

    console.log(`New prices: YES=${Number(yesPrice) / Number(PRICE_PRECISION) * 100}%, NO=${Number(noPrice) / Number(PRICE_PRECISION) * 100}%`)
  }, TEST_TIMEOUT)

  test("bob should be able to buy NO tokens with FULL PRIVACY", async () => {
    const depositAmount = 1000n
    const buyAmount = 500n

    // Bob deposits privately
    await market.methods.deposit(depositAmount)
      .send({ from: bobAddress }).wait()

    // Bob buys NO with full privacy
    const tx = await market.methods.buy_outcome(
      false, // is_yes = false (NO)
      buyAmount,
      0n, // no slippage protection for this test
    ).send({ from: bobAddress }).wait()

    expect(tx.status).toBe('success')
    console.log("Bob bought NO with FULL PRIVACY")

    const noBalance = await market.methods.get_no_balance(bobAddress).simulate({ from: bobAddress })
    expect(noBalance).toBeGreaterThan(0n)

    console.log(`Bob's private NO balance: ${noBalance}`)
  }, TEST_TIMEOUT)

  test("alice and bob should have separate private balances", async () => {
    const aliceYes = await market.methods.get_yes_balance(aliceAddress).simulate({ from: aliceAddress })
    const aliceNo = await market.methods.get_no_balance(aliceAddress).simulate({ from: aliceAddress })
    const bobYes = await market.methods.get_yes_balance(bobAddress).simulate({ from: bobAddress })
    const bobNo = await market.methods.get_no_balance(bobAddress).simulate({ from: bobAddress })

    expect(aliceYes).toBeGreaterThan(0n)
    expect(aliceNo).toBe(0n)
    expect(bobYes).toBe(0n)
    expect(bobNo).toBeGreaterThan(0n)

    console.log(`Alice: YES=${aliceYes}, NO=${aliceNo} (all PRIVATE)`)
    console.log(`Bob: YES=${bobYes}, NO=${bobNo} (all PRIVATE)`)
  }, TEST_TIMEOUT)

  test("alice should be able to withdraw remaining collateral PRIVATELY", async () => {
    const balanceBefore = await market.methods.get_collateral_balance(aliceAddress).simulate({ from: aliceAddress })
    const withdrawAmount = 500n

    // withdraw() is now a PRIVATE function
    const tx = await market.methods.withdraw(withdrawAmount)
      .send({ from: aliceAddress }).wait()

    expect(tx.status).toBe('success')

    const balanceAfter = await market.methods.get_collateral_balance(aliceAddress).simulate({ from: aliceAddress })
    expect(balanceAfter).toBe(balanceBefore - withdrawAmount)

    console.log(`Alice withdrew ${withdrawAmount} PRIVATELY, balance: ${balanceAfter}`)
  }, TEST_TIMEOUT)

  test("prices should always sum to ~100%", async () => {
    const yesPrice = await market.methods.get_price(true).simulate({ from: adminAddress })
    const noPrice = await market.methods.get_price(false).simulate({ from: adminAddress })
    // Allow for small rounding error (integer division)
    const priceSum = yesPrice + noPrice
    expect(priceSum).toBeGreaterThanOrEqual(PRICE_PRECISION - 1n)
    expect(priceSum).toBeLessThanOrEqual(PRICE_PRECISION)

    console.log(`Final prices sum check: YES=${yesPrice} + NO=${noPrice} = ${priceSum}`)
  }, TEST_TIMEOUT)
})
