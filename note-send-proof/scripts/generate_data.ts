import { GettingStartedContract } from '../contract/artifacts/GettingStarted.js';
import { Fr } from '@aztec/aztec.js/fields';
import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { TestWallet } from '@aztec/test-wallet/server';
import { computeNoteHashNonce, computeUniqueNoteHash, siloNoteHash } from '@aztec/stdlib/hash';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
import fs from 'fs';
import { exit } from 'process';

// GENERATOR_INDEX__NOTE_HASH from Aztec protocol types
const GENERATOR_INDEX__NOTE_HASH = 1;
const NODE_URL = 'http://localhost:8080';

// Must match NOTE_RANDOMNESS in the contract
const NOTE_RANDOMNESS = new Fr(6969);
// Must match the storage_slot used in create_note_for_user
const STORAGE_SLOT = new Fr(1);

async function main() {
  console.log(`Connecting to Aztec node at ${NODE_URL}`);
  const aztecNode = createAztecNodeClient(NODE_URL);
  await waitForNode(aztecNode);
  console.log('Aztec node connected');

  const wallet = await TestWallet.create(aztecNode, { dataDirectory: 'pxe-data-gen' });
  console.log('TestWallet created');

  const accountsData = await getInitialTestAccountsData();
  const deployerAccount = await wallet.createSchnorrAccount(
    accountsData[0].secret,
    accountsData[0].salt,
    accountsData[0].signingKey
  );
  const deployerAddress = deployerAccount.address;

  console.log('Deploying GettingStarted contract...');
  const gettingStarted = await GettingStartedContract.deploy(wallet, deployerAddress).send({
    from: deployerAddress,
  }).wait();

  console.log('CONTRACT DEPLOYED AT', gettingStarted.contract.address.toString());

  const NOTE_VALUE = 69n;

  console.log('Creating note for user...');
  const sentTx = await gettingStarted.contract.methods
    .create_note_for_user(NOTE_VALUE)
    .send({ from: deployerAddress })
    .wait();
  console.log('TX HASH', sentTx.txHash.toString());

  const node = createAztecNodeClient(NODE_URL);
  const txEffect = await node.getTxEffect(sentTx.txHash);

  if (txEffect === undefined) {
    throw new Error('Cannot find txEffect from tx hash');
  }

  // v3 hash computation formula:
  // 1. commitment = poseidon2([owner, storage_slot, randomness], GENERATOR_INDEX__NOTE_HASH)
  // 2. note_hash = poseidon2([commitment, value], GENERATOR_INDEX__NOTE_HASH)
  const commitment = await poseidon2HashWithSeparator(
    [deployerAddress.toField(), STORAGE_SLOT, NOTE_RANDOMNESS],
    GENERATOR_INDEX__NOTE_HASH
  );

  const noteHash = await poseidon2HashWithSeparator(
    [commitment, new Fr(NOTE_VALUE)],
    GENERATOR_INDEX__NOTE_HASH
  );

  const INDEX_OF_NOTE_HASH_IN_TRANSACTION = 0;

  const nonceGenerator = txEffect.data.nullifiers[0];

  const noteHashNonce = await computeNoteHashNonce(nonceGenerator, INDEX_OF_NOTE_HASH_IN_TRANSACTION);

  const siloedNoteHash = await siloNoteHash(gettingStarted.contract.address, noteHash);

  const computedUniqueNoteHash = await computeUniqueNoteHash(
    noteHashNonce,
    siloedNoteHash,
  );

  console.log('\n=== Note Hash Computation Verification ===');
  console.log('NOTE HASH (inner)', noteHash.toString());
  console.log('NONCE GENERATOR', nonceGenerator.toString());
  console.log('NONCE', noteHashNonce.toString());
  console.log('SILOED NOTE HASH', siloedNoteHash.toString());
  console.log('COMPUTED UNIQUE NOTE HASH', computedUniqueNoteHash.toString());
  console.log('ACTUAL UNIQUE NOTE HASH  ', txEffect.data.noteHashes[0].toString());

  const hashesMatch = computedUniqueNoteHash.toString() === txEffect.data.noteHashes[0].toString();
  console.log('\n✅ HASHES MATCH:', hashesMatch);

  if (!hashesMatch) {
    console.error('❌ ERROR: Computed hash does not match on-chain hash!');
    exit(1);
  }

  const outputData = {
    settled_note_hash: txEffect.data.noteHashes[0].toString(),
    contract_address: gettingStarted.contract.address.toString(),
    recipient: deployerAddress.toString(),
    randomness: NOTE_RANDOMNESS.toString(),
    value: Number(NOTE_VALUE),
    storage_slot: STORAGE_SLOT.toString(),
    note_nonce: noteHashNonce.toString(),
    tx_hash: sentTx.txHash.toString(),
  };

  console.log('\nREQUIRED INPUT', outputData);

  // Write data to file
  fs.writeFileSync('data.json', JSON.stringify(outputData, null, 2));
  console.log('\nData written to data.json');

  exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
