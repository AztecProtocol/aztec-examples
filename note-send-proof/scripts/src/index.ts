import { GettingStartedContract } from '../artifacts/GettingStarted.js';
import {
  Fr,
  createPXEClient,
  waitForPXE,
  createAztecNodeClient,
} from '@aztec/aztec.js';
import { getInitialTestAccountsWallets } from '@aztec/accounts/testing';
import { computeNoteHashNonce, computeUniqueNoteHash, deriveStorageSlotInMap, siloNoteHash } from '@aztec/stdlib/hash';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto';

const NOTE_HASH_SEPARATOR = 1;

export const SANDBOX_URL = 'http://localhost:8080';

const pxe = createPXEClient('http://localhost:8080');
await waitForPXE(pxe);

const wallets = await getInitialTestAccountsWallets(pxe);
const deployerWallet = wallets[0];

const gettingStarted = await GettingStartedContract.deploy(deployerWallet).send().wait();

console.log('CONTRACT DEPLOYED AT', gettingStarted.contract.address);

const NOTE_VALUE = 69;

const tx = gettingStarted.contract.methods.create_note_for_user(NOTE_VALUE);

const hello = await tx.create();

const txRequestHash = await hello.toTxRequest().hash();

console.log('TX REQUEST HASH', txRequestHash);

const sentTx = await tx.send().wait();

const node = createAztecNodeClient(SANDBOX_URL);

const txEffect = await node.getTxEffect(sentTx.txHash);

if (txEffect === undefined) {
  throw new Error('Cannot find txEffect from tx hash');
}

const storageSlot = await deriveStorageSlotInMap(GettingStartedContract.storage.user_private_state.slot, deployerWallet.getAddress());

const NOTE_RANDOMNESS = new Fr(6969);

const commitment = await poseidon2HashWithSeparator([deployerWallet.getAddress().toField(), NOTE_RANDOMNESS, storageSlot], NOTE_HASH_SEPARATOR);

const noteHash = await poseidon2HashWithSeparator([commitment, new Fr(NOTE_VALUE)], NOTE_HASH_SEPARATOR);

const INDEX_OF_NOTE_HASH_IN_TRANSACTION = 0;

const nonceGenerator = txEffect?.data.nullifiers[0] ?? txRequestHash;

const noteHashNonce = await computeNoteHashNonce(nonceGenerator, INDEX_OF_NOTE_HASH_IN_TRANSACTION);

const siloedNoteHash = await siloNoteHash(gettingStarted.contract.address, noteHash);

const computedUniqueNoteHash = await computeUniqueNoteHash(
  noteHashNonce,
  siloedNoteHash,
);

console.log('NOTE HASH', noteHash)
console.log('NONCE GENERATOR', nonceGenerator);
console.log('NONCE', noteHashNonce);
console.log('SILOED NOTE HASH', siloedNoteHash);
console.log('COMPUTED UNIQUE NOTE HASH', computedUniqueNoteHash);
console.log('ACTUAL UNIQUE NOTE HASH', txEffect.data.noteHashes[0]);

console.log('REQUIRED INPUT', {
  settled_note_hash: txEffect.data.noteHashes[0],
  contract_address: gettingStarted.contract.address,
  recipient: deployerWallet.getAddress(),
  randomness: NOTE_RANDOMNESS,
  value: NOTE_VALUE,
  storage_slot: storageSlot,
  note_nonce: noteHashNonce,
})
