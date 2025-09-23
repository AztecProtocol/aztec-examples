import { describe, expect, test, beforeAll } from '@jest/globals';
import { AccountWalletWithSecretKey, Contract, createPXEClient, waitForPXE, PXE, TxStatus, Fr } from '@aztec/aztec.js';
import { getInitialTestAccountsWallets } from '@aztec/accounts/testing';
import { GettingStartedContract, GettingStartedContractArtifact } from '../contract/artifacts/GettingStarted.js';
import { computeNoteHashNonce, computeUniqueNoteHash, deriveStorageSlotInMap, siloNoteHash } from '@aztec/stdlib/hash';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto';
import { createAztecNodeClient } from '@aztec/aztec.js';

const PXE_URL = 'http://localhost:8080';
const NOTE_HASH_SEPARATOR = 1;

// Test timeout - note creation and hash computation can take some time
const TEST_TIMEOUT = 60000; // 60 seconds

describe('Note Creation and Hash Computation', () => {
  let pxe: PXE;
  let deployer: AccountWalletWithSecretKey;
  let user1: AccountWalletWithSecretKey;
  let user2: AccountWalletWithSecretKey;
  let gettingStartedContract: GettingStartedContract;

  beforeAll(async () => {
    // Setup PXE client
    console.log(`Connecting to PXE at ${PXE_URL}`);
    pxe = createPXEClient(PXE_URL);
    await waitForPXE(pxe);
    console.log('PXE client connected');

    // Setup wallets
    const wallets = await getInitialTestAccountsWallets(pxe);
    deployer = wallets[0];
    user1 = wallets[1];
    user2 = wallets[2];

    console.log('Test wallets configured');
    console.info('Deployer address:', deployer.getAddress().toString());
    console.info('User1 address:', user1.getAddress().toString());
    console.info('User2 address:', user2.getAddress().toString());
  }, TEST_TIMEOUT);

  test('should deploy GettingStarted contract', async () => {
    gettingStartedContract = await Contract.deploy(
      deployer,
      GettingStartedContractArtifact,
      [],
      'setup'
    ).send({ from: deployer.getAddress() }).deployed() as GettingStartedContract;

    expect(gettingStartedContract.address).toBeDefined();
    expect(gettingStartedContract.address.toString()).not.toBe('');

    console.log('Contract deployed at address:', gettingStartedContract.address.toString());
  }, TEST_TIMEOUT);

  test('should create note for user and compute correct note hash', async () => {
    const NOTE_VALUE = 69;
    const NOTE_RANDOMNESS = new Fr(6969);

    // Create note
    const tx = gettingStartedContract.methods.create_note_for_user(NOTE_VALUE);
    const txExecutionRequest = await tx.create();
    const txRequestHash = await txExecutionRequest.toTxRequest().hash();

    console.log('TX REQUEST HASH', txRequestHash.toString());

    const sentTx = await tx.send({ from: deployer.getAddress() }).wait();

    expect(sentTx).toBeDefined();
    expect(sentTx.txHash).toBeDefined();
    expect(sentTx.status).toBe(TxStatus.SUCCESS);

    console.log('Transaction hash:', sentTx.txHash.toString());
    console.log('Transaction status:', sentTx.status);

    // Get transaction effect
    const node = createAztecNodeClient(PXE_URL);
    const txEffect = await node.getTxEffect(sentTx.txHash);

    expect(txEffect).toBeDefined();

    // Compute note hash components
    const storageSlot = await deriveStorageSlotInMap(
      GettingStartedContract.storage.user_private_state.slot,
      deployer.getAddress()
    );

    const commitment = await poseidon2HashWithSeparator(
      [deployer.getAddress().toField(), NOTE_RANDOMNESS, storageSlot],
      NOTE_HASH_SEPARATOR
    );

    const noteHash = await poseidon2HashWithSeparator(
      [commitment, new Fr(NOTE_VALUE)],
      NOTE_HASH_SEPARATOR
    );

    const INDEX_OF_NOTE_HASH_IN_TRANSACTION = 0;
    const nonceGenerator = txEffect?.data.nullifiers[0] ?? txRequestHash;

    const noteHashNonce = await computeNoteHashNonce(
      nonceGenerator,
      INDEX_OF_NOTE_HASH_IN_TRANSACTION
    );

    const siloedNoteHash = await siloNoteHash(
      gettingStartedContract.address,
      noteHash
    );

    const computedUniqueNoteHash = await computeUniqueNoteHash(
      noteHashNonce,
      siloedNoteHash
    );

    const actualUniqueNoteHash = txEffect!.data.noteHashes[0];

    console.log('NOTE HASH:', noteHash.toString());
    console.log('COMPUTED UNIQUE NOTE HASH:', computedUniqueNoteHash.toString());
    console.log('ACTUAL UNIQUE NOTE HASH:', actualUniqueNoteHash.toString());

    // Verify computed hash matches actual hash
    expect(computedUniqueNoteHash.toString()).toBe(actualUniqueNoteHash.toString());
  }, TEST_TIMEOUT);
});
