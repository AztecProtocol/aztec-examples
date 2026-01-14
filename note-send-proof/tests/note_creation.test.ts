import { describe, expect, test, beforeAll } from '@jest/globals';
import { TxStatus, Fr } from '@aztec/aztec.js';
import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { TestWallet } from '@aztec/test-wallet/server';
import type { TestWallet as TestWalletType } from '@aztec/test-wallet/server';
import { GettingStartedContract, GettingStartedContractArtifact } from '../contract/artifacts/GettingStarted.js';

const NODE_URL = 'http://localhost:8080';

// Test timeout - note creation and hash computation can take some time
const TEST_TIMEOUT = 120000; // 120 seconds

describe('Note Creation and Balance Tracking', () => {
  let wallet: TestWalletType;
  let deployer: AztecAddress;
  let user1: AztecAddress;
  let gettingStartedContract: GettingStartedContract;

  beforeAll(async () => {
    // Setup node client
    console.log(`Connecting to Aztec node at ${NODE_URL}`);
    const aztecNode = createAztecNodeClient(NODE_URL);
    await waitForNode(aztecNode);
    console.log('Aztec node connected');

    // Create TestWallet
    wallet = await TestWallet.create(aztecNode, { dataDirectory: 'pxe-test-data' });
    console.log('TestWallet created');

    // Get test account data
    const accountsData = await getInitialTestAccountsData();

    // Create accounts using the wallet
    const deployerAccount = await wallet.createSchnorrAccount(
      accountsData[0].secret,
      accountsData[0].salt,
      accountsData[0].signingKey
    );
    deployer = deployerAccount.address;

    const user1Account = await wallet.createSchnorrAccount(
      accountsData[1].secret,
      accountsData[1].salt,
      accountsData[1].signingKey
    );
    user1 = user1Account.address;

    console.log('Test accounts configured');
    console.info('Deployer address:', deployer.toString());
    console.info('User1 address:', user1.toString());
  }, TEST_TIMEOUT);

  test('should deploy GettingStarted contract', async () => {
    gettingStartedContract = await GettingStartedContract.deploy(wallet, deployer)
      .send({ from: deployer })
      .deployed();

    expect(gettingStartedContract.address).toBeDefined();
    expect(gettingStartedContract.address.toString()).not.toBe('');

    console.log('Contract deployed at address:', gettingStartedContract.address.toString());
  }, TEST_TIMEOUT);

  test('should create note for user and track balance', async () => {
    const NOTE_VALUE = 100n;

    // Get initial balance (should be 0)
    const initialBalance = await gettingStartedContract.methods
      .get_user_balance(deployer)
      .simulate({ from: deployer });

    expect(initialBalance).toBe(0n);
    console.log('Initial balance:', initialBalance.toString());

    // Create note
    const tx = await gettingStartedContract.methods
      .create_note_for_user(NOTE_VALUE)
      .send({ from: deployer })
      .wait();

    expect(tx).toBeDefined();
    expect(tx.txHash).toBeDefined();
    expect(tx.status).toBe('success');

    console.log('Transaction hash:', tx.txHash.toString());
    console.log('Transaction status:', tx.status);

    // Check balance after note creation
    const finalBalance = await gettingStartedContract.methods
      .get_user_balance(deployer)
      .simulate({ from: deployer });

    expect(finalBalance).toBe(NOTE_VALUE);
    console.log('Final balance:', finalBalance.toString());
  }, TEST_TIMEOUT);

  test('should accumulate multiple notes', async () => {
    const ADDITIONAL_VALUE = 50n;

    // Get current balance
    const currentBalance = await gettingStartedContract.methods
      .get_user_balance(deployer)
      .simulate({ from: deployer });

    // Create another note
    await gettingStartedContract.methods
      .create_note_for_user(ADDITIONAL_VALUE)
      .send({ from: deployer })
      .wait();

    // Check accumulated balance
    const newBalance = await gettingStartedContract.methods
      .get_user_balance(deployer)
      .simulate({ from: deployer });

    expect(newBalance).toBe(currentBalance + ADDITIONAL_VALUE);
    console.log('Accumulated balance:', newBalance.toString());
  }, TEST_TIMEOUT);
});
