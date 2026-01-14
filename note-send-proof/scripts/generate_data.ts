import { GettingStartedContract } from '../contract/artifacts/GettingStarted.js';
import { Fr } from '@aztec/aztec.js/fields';
import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { TestWallet } from '@aztec/test-wallet/server';
import { computeNoteHashNonce, computeUniqueNoteHash, deriveStorageSlotInMap, siloNoteHash } from '@aztec/stdlib/hash';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
import fs from 'fs';
import { exit } from 'process';

const NOTE_HASH_SEPARATOR = 1;
const NODE_URL = 'http://localhost:8080';

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

  const NOTE_VALUE = 69;

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

  const storageSlot = await deriveStorageSlotInMap(GettingStartedContract.storage.user_balances.slot, deployerAddress);

  const NOTE_RANDOMNESS = new Fr(6969);

  const commitment = await poseidon2HashWithSeparator([deployerAddress.toField(), NOTE_RANDOMNESS, storageSlot], NOTE_HASH_SEPARATOR);

  const noteHash = await poseidon2HashWithSeparator([commitment, new Fr(NOTE_VALUE)], NOTE_HASH_SEPARATOR);

  const INDEX_OF_NOTE_HASH_IN_TRANSACTION = 0;

  const nonceGenerator = txEffect.data.nullifiers[0];

  const noteHashNonce = await computeNoteHashNonce(nonceGenerator, INDEX_OF_NOTE_HASH_IN_TRANSACTION);

  const siloedNoteHash = await siloNoteHash(gettingStarted.contract.address, noteHash);

  const computedUniqueNoteHash = await computeUniqueNoteHash(
    noteHashNonce,
    siloedNoteHash,
  );

  console.log('NOTE HASH', noteHash.toString());
  console.log('NONCE GENERATOR', nonceGenerator.toString());
  console.log('NONCE', noteHashNonce.toString());
  console.log('SILOED NOTE HASH', siloedNoteHash.toString());
  console.log('COMPUTED UNIQUE NOTE HASH', computedUniqueNoteHash.toString());
  console.log('ACTUAL UNIQUE NOTE HASH', txEffect.data.noteHashes[0].toString());

  const outputData = {
    settled_note_hash: txEffect.data.noteHashes[0].toString(),
    contract_address: gettingStarted.contract.address.toString(),
    recipient: deployerAddress.toString(),
    randomness: NOTE_RANDOMNESS.toString(),
    value: NOTE_VALUE,
    storage_slot: storageSlot.toString(),
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
