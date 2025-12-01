import { Fr } from '@aztec/foundation/fields';
import { ContractArtifact, type FunctionAbi, FunctionSelector, encodeArguments, loadContractArtifact } from '@aztec/stdlib/abi';
import type { AztecAddress } from '@aztec/stdlib/aztec-address';
import type { GasSettings } from '@aztec/stdlib/gas';
import { HashedValues, TxContext, TxExecutionRequest } from '@aztec/stdlib/tx';

import { AuthWitnessProvider, ChainInfo, EntrypointInterface } from '@aztec/entrypoints/interfaces';
import { ExecutionPayload } from '@aztec/entrypoints/payload';
import { EncodedAppEntrypointCalls } from '@aztec/entrypoints/encoding';
import { DefaultAccountEntrypointOptions } from '@aztec/entrypoints/account';
import { AccountContract, AccountInterface } from '@aztec/aztec.js/account';
import { CompleteAddress } from '@aztec/stdlib/contract';
import { AuthWitness } from '@aztec/stdlib/auth-witness';
import { NoirCompiledContract } from '@aztec/stdlib/noir';

import PasswordAccountContractJson from '../target/custom_account-PasswordAccount.json' with { type: 'json' };

export const PasswordAccountContractArtifact: ContractArtifact = loadContractArtifact(
  PasswordAccountContractJson as NoirCompiledContract,
);


/** Default L1 chain ID to use when constructing txs (matches hardhat and anvil's default). */
export const DEFAULT_CHAIN_ID = 31337;
/** Default protocol version to use. */
export const DEFAULT_VERSION = 1;

/**
 * Implementation for an entrypoint interface that follows the default entrypoint signature
 * for an account, which accepts an AppPayload and a FeePayload as defined in noir-libs/aztec-noir/src/entrypoint module
 */
export class PasswordAccountEntrypoint implements EntrypointInterface {
  constructor(
    private address: AztecAddress,
    private auth: AuthWitnessProvider,
    private password: Fr,
    private chainId: number = DEFAULT_CHAIN_ID,
    private version: number = DEFAULT_VERSION,
  ) {}

  async createTxExecutionRequest(
    exec: ExecutionPayload,
    gasSettings: GasSettings,
    options: DefaultAccountEntrypointOptions,
  ): Promise<TxExecutionRequest> {
    // Initial request with calls, authWitnesses and capsules
    const { calls, authWitnesses, capsules, extraHashedArgs } = exec;
    // Global tx options
    const { cancellable, txNonce, feePaymentMethodOptions } = options;
    // Encode the calls for the app
    const encodedCalls = await EncodedAppEntrypointCalls.create(calls, txNonce);

    // Obtain the entrypoint hashed args, built from the app encoded calls and global options
    const abi = this.getEntrypointAbi();
    const entrypointHashedArgs = await HashedValues.fromArgs(
      encodeArguments(abi, [encodedCalls, feePaymentMethodOptions, !!cancellable, this.password]),
    );

    // Generate the payload auth witness, by signing the hash of the payload
    const appPayloadAuthWitness = await this.auth.createAuthWit(await encodedCalls.hash());

    // Assemble the tx request
    const txRequest = TxExecutionRequest.from({
      firstCallArgsHash: entrypointHashedArgs.hash,
      origin: this.address,
      functionSelector: await FunctionSelector.fromNameAndParameters(abi.name, abi.parameters),
      txContext: new TxContext(this.chainId, this.version, gasSettings),
      argsOfCalls: [...encodedCalls.hashedArguments, entrypointHashedArgs, ...extraHashedArgs],
      authWitnesses: [...authWitnesses, appPayloadAuthWitness],
      capsules,
      salt: Fr.random(),
    });

    return txRequest;
  }

  private getEntrypointAbi() {
    return {
      name: 'entrypoint',
      isInitializer: false,
      functionType: 'private',
      isInternal: false,
      isStatic: false,
      parameters: [{"name":"app_payload","type":{"kind":"struct","fields":[{"name":"function_calls","type":{"kind":"array","length":5,"type":{"kind":"struct","fields":[{"name":"args_hash","type":{"kind":"field"}},{"name":"function_selector","type":{"kind":"struct","fields":[{"name":"inner","type":{"kind":"integer","sign":"unsigned","width":32}}],"path":"aztec::protocol_types::abis::function_selector::FunctionSelector"}},{"name":"target_address","type":{"kind":"struct","fields":[{"name":"inner","type":{"kind":"field"}}],"path":"aztec::protocol_types::address::aztec_address::AztecAddress"}},{"name":"is_public","type":{"kind":"boolean"}},{"name":"hide_msg_sender","type":{"kind":"boolean"}},{"name":"is_static","type":{"kind":"boolean"}}],"path":"aztec::authwit::entrypoint::function_call::FunctionCall"}}},{"name":"tx_nonce","type":{"kind":"field"}}],"path":"aztec::authwit::entrypoint::app::AppPayload"},"visibility":"private"},{"name":"fee_payment_method","type":{"kind":"integer","sign":"unsigned","width":8},"visibility":"private"},{"name":"cancellable","type":{"kind":"boolean"},"visibility":"private"},{"name":"password","type":{"kind":"field"},"visibility":"private"}],
      returnTypes: [],
      errorTypes: {},
    } as FunctionAbi;
  }
}

export class PasswordAccountInterface implements AccountInterface {
  protected entrypoint: EntrypointInterface;

  private chainId: Fr;
  private version: Fr;

  constructor(
    private authWitnessProvider: AuthWitnessProvider,
    private address: CompleteAddress,
    chainInfo: ChainInfo,
    private password: Fr,
  ) {
    this.entrypoint = new PasswordAccountEntrypoint(
      address.address,
      authWitnessProvider,
      this.password,
      chainInfo.chainId.toNumber(),
      chainInfo.version.toNumber(),
    );
    this.chainId = chainInfo.chainId;
    this.version = chainInfo.version;
  }

  createTxExecutionRequest(
    exec: ExecutionPayload,
    gasSettings: GasSettings,
    options: DefaultAccountEntrypointOptions,
  ): Promise<TxExecutionRequest> {
    return this.entrypoint.createTxExecutionRequest(exec, gasSettings, options);
  }

  createAuthWit(messageHash: Fr): Promise<AuthWitness> {
    return this.authWitnessProvider.createAuthWit(messageHash);
  }

  getCompleteAddress(): CompleteAddress {
    return this.address;
  }

  getAddress(): AztecAddress {
    return this.address.address;
  }

  getChainId(): Fr {
    return this.chainId;
  }

  getVersion(): Fr {
    return this.version;
  }
}

export class PasswordAccountContract implements AccountContract {
  constructor(private password: Fr) {}

  getAuthWitnessProvider(_address: CompleteAddress): AuthWitnessProvider {
    return new PasswordAuthWitnessProvider(this.password);
  }

  async getInitializationFunctionAndArgs() {
    return { constructorName: 'constructor', constructorArgs: [this.password] };
  }

  getContractArtifact(): Promise<ContractArtifact> {
    return Promise.resolve(PasswordAccountContractArtifact);
  };

  getInterface(address: CompleteAddress, chainInfo: ChainInfo): AccountInterface {
    return new PasswordAccountInterface(this.getAuthWitnessProvider(address), address, chainInfo, this.password);
  }
}

export class PasswordAuthWitnessProvider implements AuthWitnessProvider {
  constructor(private password: Fr) {}

  async createAuthWit(messageHash: Fr): Promise<AuthWitness> {
    return new AuthWitness(messageHash, [this.password]);
  }
}
