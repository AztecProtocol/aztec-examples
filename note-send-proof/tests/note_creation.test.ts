import { describe, expect, test, beforeAll } from '@jest/globals';
import { Fr } from '@aztec/aztec.js/fields';
import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { computeNoteHashNonce, computeUniqueNoteHash, siloNoteHash } from '@aztec/stdlib/hash';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
import { GettingStartedContract } from '../contract/artifacts/GettingStarted.js';

const NODE_URL = 'http://localhost:8080';

// DOM_SEP__NOTE_HASH from Aztec protocol types (v4 value)
const DOM_SEP__NOTE_HASH = 116501019;

// Must match NOTE_RANDOMNESS in the contract
const NOTE_RANDOMNESS = new Fr(6969);
// Must match the storage_slot used in create_note_for_user
const STORAGE_SLOT = new Fr(1);

// Test timeout - note creation and hash computation can take some time
const TEST_TIMEOUT = 120000; // 120 seconds

describe('Note Hash Computation Verification', () => {
  let wallet: EmbeddedWallet;
  let deployer: AztecAddress;
  let gettingStartedContract: GettingStartedContract;

  beforeAll(async () => {
    // Setup node client
    console.log(`Connecting to Aztec node at ${NODE_URL}`);
    const aztecNode = createAztecNodeClient(NODE_URL);
    await waitForNode(aztecNode);
    console.log('Aztec node connected');

    // Create EmbeddedWallet
    wallet = await EmbeddedWallet.create(aztecNode, { ephemeral: true });
    console.log('EmbeddedWallet created');

    // Get test account data
    const accountsData = await getInitialTestAccountsData();

    // Create accounts using the wallet
    const deployerAccount = await wallet.createSchnorrAccount(
      accountsData[0].secret,
      accountsData[0].salt,
      accountsData[0].signingKey
    );
    deployer = deployerAccount.address;

    console.log('Test accounts configured');
    console.info('Deployer address:', deployer.toString());
  }, TEST_TIMEOUT);

  test('should deploy GettingStarted contract', async () => {
    ({ contract: gettingStartedContract } = await GettingStartedContract.deploy(wallet, deployer)
      .send({ from: deployer }));

    expect(gettingStartedContract.address).toBeDefined();
    expect(gettingStartedContract.address.toString()).not.toBe('');

    console.log('Contract deployed at address:', gettingStartedContract.address.toString());
  }, TEST_TIMEOUT);

  test('should create note and verify computed hash matches on-chain hash', async () => {
    const NOTE_VALUE = 69n;

    // Create note
    const receipt = await gettingStartedContract.methods
      .create_note_for_user(NOTE_VALUE)
      .send({ from: deployer });

    expect(receipt).toBeDefined();
    expect(receipt.txHash).toBeDefined();
    expect(receipt.executionResult).toBe('success');

    console.log('Transaction hash:', receipt.txHash.toString());
    console.log('Transaction status:', receipt.status);

    // Get the transaction effect to access the note hashes
    const node = createAztecNodeClient(NODE_URL);
    const txEffect = await node.getTxEffect(receipt.txHash);

    expect(txEffect).toBeDefined();
    if (!txEffect) {
      throw new Error('Cannot find txEffect from tx hash');
    }

    // Compute the note hash:
    // 1. commitment = poseidon2([owner, storage_slot, randomness], DOM_SEP__NOTE_HASH)
    // 2. note_hash = poseidon2([commitment, value], DOM_SEP__NOTE_HASH)
    const commitment = await poseidon2HashWithSeparator(
      [deployer.toField(), STORAGE_SLOT, NOTE_RANDOMNESS],
      DOM_SEP__NOTE_HASH
    );

    const noteHash = await poseidon2HashWithSeparator(
      [commitment, new Fr(NOTE_VALUE)],
      DOM_SEP__NOTE_HASH
    );

    console.log('Computed inner note hash:', noteHash.toString());

    // Compute the unique note hash (which is what gets stored on-chain)
    const INDEX_OF_NOTE_HASH_IN_TRANSACTION = 0;
    const nonceGenerator = txEffect.data.nullifiers[0];
    const noteHashNonce = await computeNoteHashNonce(nonceGenerator, INDEX_OF_NOTE_HASH_IN_TRANSACTION);
    const siloedNoteHash = await siloNoteHash(gettingStartedContract.address, noteHash);
    const computedUniqueNoteHash = await computeUniqueNoteHash(noteHashNonce, siloedNoteHash);

    console.log('Siloed note hash:', siloedNoteHash.toString());
    console.log('Computed unique note hash:', computedUniqueNoteHash.toString());
    console.log('Actual on-chain note hash:', txEffect.data.noteHashes[0].toString());

    // Verify the computed hash matches the on-chain hash
    expect(computedUniqueNoteHash.toString()).toBe(txEffect.data.noteHashes[0].toString());
    console.log('✅ Hash verification successful!');
  }, TEST_TIMEOUT);

  test('should create note with different value and verify hash', async () => {
    const NOTE_VALUE = 42n;

    // Create note with different value
    const receipt = await gettingStartedContract.methods
      .create_note_for_user(NOTE_VALUE)
      .send({ from: deployer });

    expect(receipt.executionResult).toBe('success');

    // Get the transaction effect
    const node = createAztecNodeClient(NODE_URL);
    const txEffect = await node.getTxEffect(receipt.txHash);
    expect(txEffect).toBeDefined();
    if (!txEffect) {
      throw new Error('Cannot find txEffect from tx hash');
    }

    // Compute the note hash
    const commitment = await poseidon2HashWithSeparator(
      [deployer.toField(), STORAGE_SLOT, NOTE_RANDOMNESS],
      DOM_SEP__NOTE_HASH
    );

    const noteHash = await poseidon2HashWithSeparator(
      [commitment, new Fr(NOTE_VALUE)],
      DOM_SEP__NOTE_HASH
    );

    // Compute unique hash
    const nonceGenerator = txEffect.data.nullifiers[0];
    const noteHashNonce = await computeNoteHashNonce(nonceGenerator, 0);
    const siloedNoteHash = await siloNoteHash(gettingStartedContract.address, noteHash);
    const computedUniqueNoteHash = await computeUniqueNoteHash(noteHashNonce, siloedNoteHash);

    // Verify
    expect(computedUniqueNoteHash.toString()).toBe(txEffect.data.noteHashes[0].toString());
    console.log('✅ Hash verification successful for value', NOTE_VALUE.toString());
  }, TEST_TIMEOUT);
});
