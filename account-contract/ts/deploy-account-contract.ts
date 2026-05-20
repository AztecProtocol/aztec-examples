import { AztecAddress } from '@aztec/aztec.js/addresses';
import { NO_FROM } from '@aztec/aztec.js/account';
import { Fr } from '@aztec/aztec.js/fields';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Contract, DeployMethod, type DeployOptions } from '@aztec/aztec.js/contracts';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { deriveKeys } from '@aztec/aztec.js/keys';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { PasswordAccountContract } from './password-account-entrypoint';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { AccountManager } from '@aztec/aztec.js/wallet';

async function getSponsoredPFCContract() {
  const instance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    {
      salt: new Fr(SPONSORED_FPC_SALT),
    }
  );

  return instance;
}

const deployAccountOpts: DeployOptions = {
  skipClassPublication: false,
  skipInstancePublication: false,
  skipInitialization: false,
  from: NO_FROM,
  fee: {
    paymentMethod: new SponsoredFeePaymentMethod(
      (await getSponsoredPFCContract()).address
    ),
  },
};

const passwordAccountContract = new PasswordAccountContract(new Fr(123123123123));
const artifact = await passwordAccountContract.getContractArtifact();

const { constructorName, constructorArgs } = await passwordAccountContract.getInitializationFunctionAndArgs();

console.log(constructorName, constructorArgs);

const secretKey = Fr.random();
// const salt = Fr.random();
const { publicKeys } = await deriveKeys(secretKey);
const wallet = await EmbeddedWallet.create(createAztecNodeClient('http://localhost:8080'), { ephemeral: true });

// This doesn't work due to a strange bug in fee payment
// const deployPasswordAccountMethod = new DeployAccountMethod(
//   publicKeys,
//   wallet,
//   artifact,
//   address => Contract.at(address, artifact, wallet),
//   salt,
//   constructorArgs,
//   constructorName,
// );

await wallet.registerContract(await getSponsoredPFCContract(), SponsoredFPCContractArtifact);

const accountContractDeployMethod = DeployMethod.create(
    wallet,
    {
        artifact,
        postDeployCtor: (instance, wallet) => Contract.at(instance.address, artifact, wallet),
        args: constructorArgs,
        constructorNameOrArtifact: constructorName,
    },
    { salt: Fr.ONE, universalDeploy: true, publicKeys },
);

const { estimatedGas, stats } = await accountContractDeployMethod.simulate(deployAccountOpts);

console.log(estimatedGas);
console.log(stats);

const { contract: deployedAccountContract } = await accountContractDeployMethod.send(deployAccountOpts);

console.log('PasswordAccount contract deployed at:', deployedAccountContract.address);

// Create and register an account using the deployed contract
const accountManager = await AccountManager.create(wallet, Fr.random(), passwordAccountContract, Fr.random());
console.log('Account registered at:', accountManager.address.toString());
