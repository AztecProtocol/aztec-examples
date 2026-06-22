import { GettingStartedContract } from '../artifacts/target/GettingStarted.js';
import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { Fr } from '@aztec/aztec.js/fields';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { computeNoteHashNonce, computeUniqueNoteHash, siloNoteHash } from '@aztec/stdlib/hash';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';

// DOM_SEP__NOTE_HASH from Aztec protocol types (v5 value)
const DOM_SEP__NOTE_HASH = 116501019;
// DOM_SEP__PARTIAL_NOTE_COMMITMENT from Aztec protocol types (v5 value)
const DOM_SEP__PARTIAL_NOTE_COMMITMENT = 568912195;

export const NODE_URL = 'http://localhost:8080';

const node = createAztecNodeClient(NODE_URL);
await waitForNode(node);

const wallet = await EmbeddedWallet.create(node, { ephemeral: true });

const accountsData = await getInitialTestAccountsData();
const deployerAccount = await wallet.createSchnorrInitializerlessAccount(
  accountsData[0].secret,
  accountsData[0].salt,
  accountsData[0].signingKey
);
const deployerAddress = deployerAccount.address;

const { contract: gettingStarted } = await GettingStartedContract.deploy(wallet, deployerAddress).send({
  from: deployerAddress,
});

console.log('CONTRACT DEPLOYED AT', gettingStarted.address);

const NOTE_VALUE = 69;

const { receipt } = await gettingStarted.methods.create_note_for_user(NOTE_VALUE).send({ from: deployerAddress });

console.log('TX HASH', receipt.txHash);

const txReceipt = await node.getTxReceipt(receipt.txHash, { includeTxEffect: true });

if (!txReceipt.isMined() || !txReceipt.txEffect) {
  throw new Error('Cannot find txEffect from tx hash');
}
const txEffect = txReceipt.txEffect;

const NOTE_RANDOMNESS = new Fr(6969);
// storage_slot = 1 as used in the contract's create_note_for_user
const STORAGE_SLOT = new Fr(1);

// Compute inner note hash using v5 partial-note formula:
// 1. commitment = poseidon2([owner, randomness], DOM_SEP__PARTIAL_NOTE_COMMITMENT)
// 2. note_hash = poseidon2([storage_slot, commitment, value], DOM_SEP__NOTE_HASH)
const commitment = await poseidon2HashWithSeparator([deployerAddress.toField(), NOTE_RANDOMNESS], DOM_SEP__PARTIAL_NOTE_COMMITMENT);

const noteHash = await poseidon2HashWithSeparator([STORAGE_SLOT, commitment, new Fr(NOTE_VALUE)], DOM_SEP__NOTE_HASH);

const INDEX_OF_NOTE_HASH_IN_TRANSACTION = 0;

const nonceGenerator = txEffect.nullifiers[0];

const noteHashNonce = await computeNoteHashNonce(nonceGenerator, INDEX_OF_NOTE_HASH_IN_TRANSACTION);

const siloedNoteHash = await siloNoteHash(gettingStarted.address, noteHash);

const computedUniqueNoteHash = await computeUniqueNoteHash(
  noteHashNonce,
  siloedNoteHash,
);

console.log('NOTE HASH', noteHash)
console.log('NONCE GENERATOR', nonceGenerator);
console.log('NONCE', noteHashNonce);
console.log('SILOED NOTE HASH', siloedNoteHash);
console.log('COMPUTED UNIQUE NOTE HASH', computedUniqueNoteHash);
console.log('ACTUAL UNIQUE NOTE HASH', txEffect.noteHashes[0]);

console.log('REQUIRED INPUT', {
  settled_note_hash: txEffect.noteHashes[0],
  contract_address: gettingStarted.address,
  recipient: deployerAddress,
  randomness: NOTE_RANDOMNESS,
  value: NOTE_VALUE,
  storage_slot: STORAGE_SLOT,
  note_nonce: noteHashNonce,
})
