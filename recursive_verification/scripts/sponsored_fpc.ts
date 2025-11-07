import { type ContractInstanceWithAddress, getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/aztec.js/fields';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { LogFn } from '@aztec/foundation/log';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';

const SPONSORED_FPC_SALT = new Fr(BigInt(0));

export async function getSponsoredFPCInstance(): Promise<ContractInstanceWithAddress> {
    return await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
        salt: SPONSORED_FPC_SALT,
    });
}

export async function getSponsoredFPCAddress() {
  return (await getSponsoredFPCInstance()).address;
}

export async function setupSponsoredFPC(wallet: Wallet) {
  const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
    salt: new Fr(SPONSORED_FPC_SALT),
  });

  await wallet.registerContract({ instance, artifact: SponsoredFPCContract.artifact });
  return instance;
}
