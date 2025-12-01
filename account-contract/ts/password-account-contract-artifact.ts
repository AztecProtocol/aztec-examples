import { ContractArtifact, loadContractArtifact } from '@aztec/stdlib/abi';
import PasswordAccountContractJson from '../target/custom_account-PasswordAccount.json' with { type: 'json' };
import { NoirCompiledContract } from '@aztec/stdlib/noir';

export const PasswordAccountContractArtifact: ContractArtifact = loadContractArtifact(
  PasswordAccountContractJson as NoirCompiledContract,
);
