import { Fr } from '@aztec/aztec.js/fields';
import { Contract } from '@aztec/aztec.js/contracts';
import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { deriveKeys } from '@aztec/aztec.js/keys';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { AccountManager } from '@aztec/aztec.js/wallet';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { PasswordAccountContract } from './password-account-entrypoint';

const NODE_URL = 'http://localhost:8080';
const PASSWORD = new Fr(123123123123);

const node = await createAztecNodeClient(NODE_URL);
await waitForNode(node);
const wallet = await EmbeddedWallet.create(node, { ephemeral: true });

// A prefunded local-network test account acts as the deployer and pays the fee from its
// fee-juice balance. We deploy the PasswordAccount as a normal contract (publishing its class +
// instance and running its constructor) rather than self-deploying it: the account's entrypoint
// authorizes a tx by reading the `hashed_password` PublicImmutable, which is only written by its
// own constructor — so it cannot authorize its very first (self-deploy) tx.
const [testAccount] = await getInitialTestAccountsData();
const deployer = await wallet.createSchnorrInitializerlessAccount(
  testAccount.secret,
  testAccount.salt,
  testAccount.signingKey,
);
console.log('Deployer (prefunded) address:', deployer.address.toString());

// The account's address derives from (public keys, salt, ctor args). Derive the keys from the
// secret and reuse the same fixed salt everywhere so the address is deterministic and the
// AccountManager registration below resolves to the deployed instance.
const secretKey = Fr.random();
const { publicKeys } = await deriveKeys(secretKey);
const passwordAccountContract = new PasswordAccountContract(PASSWORD);
const artifact = await passwordAccountContract.getContractArtifact();

const accountManager = await AccountManager.create(wallet, secretKey, passwordAccountContract, {
  salt: Fr.ONE,
});
console.log('PasswordAccount address:     ', accountManager.address.toString());

// `universalDeploy` keeps the instance deployer at AztecAddress.ZERO (matching the
// AccountManager-derived address); the funded test account still sends + pays for the tx.
const deployMethod = Contract.deploy(wallet, artifact, [PASSWORD], 'constructor', {
  salt: Fr.ONE,
  publicKeys,
  universalDeploy: true,
});
const { contract: deployedAccountContract } = await deployMethod.send({
  from: deployer.address,
  wait: { timeout: 120 },
});

console.log('PasswordAccount deployed at: ', deployedAccountContract.address.toString());
console.log('Account registered at:       ', accountManager.address.toString());
console.log(
  'Deployed == registered:      ',
  deployedAccountContract.address.equals(accountManager.address),
);
