import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Contract, DeployMethod, type DeployOptions } from '@aztec/aztec.js/contracts';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { deriveKeys } from '@aztec/aztec.js/keys';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { PasswordAccountContract } from './password-account-entrypoint';
import { TestWallet } from '@aztec/test-wallet/server';

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
  from: AztecAddress.ZERO,
  fee: {
    paymentMethod: new SponsoredFeePaymentMethod(
      (await getSponsoredPFCContract()).address
    ),
  },
  contractAddressSalt: Fr.ONE,
  universalDeploy: true,
};

const passwordAccountContract = new PasswordAccountContract(new Fr(123123123123));
const artifact = await passwordAccountContract.getContractArtifact();

const { constructorName, constructorArgs } = await passwordAccountContract.getInitializationFunctionAndArgs();

console.log(constructorName, constructorArgs);

const secretKey = Fr.random();
// const salt = Fr.random();
const { publicKeys } = await deriveKeys(secretKey);
const wallet = await TestWallet.create(createAztecNodeClient('http://localhost:8080'));

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

const accountContractDeployMethod = new DeployMethod(
    publicKeys,
    wallet,
    artifact,
    (instance, wallet) => Contract.at(instance.address, artifact, wallet),
    constructorArgs,
    constructorName,
)

const { estimatedGas, stats } = await accountContractDeployMethod.simulate(deployAccountOpts);

console.log(estimatedGas);
console.log(stats);

const deployedAccountContract = await accountContractDeployMethod.send(deployAccountOpts).wait();

console.log('PasswordAccount contract deployed at:', deployedAccountContract.contract.address);

// Create and register an account using the deployed contract
const account = await wallet.createAccount({ secret: Fr.random(), contract: passwordAccountContract, salt: Fr.random() });
console.log('Account registered at:', account.address.toString());
