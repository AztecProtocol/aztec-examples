import { Fr } from '@aztec/aztec.js/fields';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { type ContractArtifact, type FunctionAbi, FunctionCall, FunctionSelector, encodeArguments, loadContractArtifact } from '@aztec/stdlib/abi';
import type { GasSettings } from '@aztec/stdlib/gas';
import { ExecutionPayload, HashedValues, TxContext, TxExecutionRequest } from '@aztec/stdlib/tx';
import { CompleteAddress } from '@aztec/stdlib/contract';
import { AuthWitness } from '@aztec/stdlib/auth-witness';
import type { NoirCompiledContract } from '@aztec/stdlib/noir';

import type { AuthWitnessProvider, ChainInfo, EntrypointInterface } from '@aztec/entrypoints/interfaces';
import { EncodedAppEntrypointCalls } from '@aztec/entrypoints/encoding';
import type { DefaultAccountEntrypointOptions } from '@aztec/entrypoints/account';
import { type Account, type AccountContract, BaseAccount } from '@aztec/aztec.js/account';

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
  ) {}

  async createTxExecutionRequest(
    exec: ExecutionPayload,
    gasSettings: GasSettings,
    chainInfo: ChainInfo,
    options: DefaultAccountEntrypointOptions,
  ): Promise<TxExecutionRequest> {
    // Initial request with calls, authWitnesses and capsules
    const { authWitnesses, capsules, extraHashedArgs } = exec;
    const { encodedCalls, entrypointHashedArgs, functionSelector, payloadAuthWitness } =
      await this.#buildEntrypointCallData(exec, options);

    // Assemble the tx request
    const txRequest = TxExecutionRequest.from({
      firstCallArgsHash: entrypointHashedArgs.hash,
      origin: this.address,
      functionSelector,
      txContext: new TxContext(chainInfo.chainId.toNumber(), chainInfo.version.toNumber(), gasSettings),
      argsOfCalls: [...encodedCalls.hashedArguments, entrypointHashedArgs, ...extraHashedArgs],
      authWitnesses: [...authWitnesses, payloadAuthWitness],
      capsules,
      salt: Fr.random(),
    });

    return txRequest;
  }

  async wrapExecutionPayload(
    exec: ExecutionPayload,
    _chainInfo: ChainInfo,
    options: DefaultAccountEntrypointOptions,
  ): Promise<ExecutionPayload> {
    const { authWitnesses, capsules, extraHashedArgs, feePayer } = exec;
    const { encodedCalls, abi, entrypointArgs, functionSelector, payloadAuthWitness } =
      await this.#buildEntrypointCallData(exec, options);

    // Build the entrypoint function call
    const entrypointCall = FunctionCall.from({
      name: abi.name,
      to: this.address,
      selector: functionSelector,
      type: abi.functionType,
      hideMsgSender: false,
      isStatic: abi.isStatic,
      args: entrypointArgs,
      returnTypes: abi.returnTypes,
    });

    return new ExecutionPayload(
      [entrypointCall],
      [payloadAuthWitness, ...authWitnesses],
      capsules,
      [...encodedCalls.hashedArguments, ...extraHashedArgs],
      feePayer ?? this.address,
    );
  }

  // Builds the data shared by createTxExecutionRequest and wrapExecutionPayload: the encoded app
  // calls, the entrypoint args/selector, and the payload auth witness.
  async #buildEntrypointCallData(exec: ExecutionPayload, options: DefaultAccountEntrypointOptions) {
    // Initial request with calls, authWitnesses and capsules
    const { calls } = exec;
    // Global tx options
    const { cancellable, txNonce, feePaymentMethodOptions } = options;
    // Encode the calls for the app
    const encodedCalls = await EncodedAppEntrypointCalls.create(calls, txNonce);

    // Obtain the entrypoint hashed args, built from the app encoded calls and global options
    const abi = this.getEntrypointAbi();
    const entrypointArgs = encodeArguments(abi, [encodedCalls, feePaymentMethodOptions, !!cancellable, this.password]);
    const entrypointHashedArgs = await HashedValues.fromArgs(entrypointArgs);

    const functionSelector = await FunctionSelector.fromNameAndParameters(abi.name, abi.parameters);

    // Generate the payload auth witness, by signing the hash of the payload
    const payloadAuthWitness = await this.auth.createAuthWit(await encodedCalls.hash());

    return { encodedCalls, abi, entrypointArgs, entrypointHashedArgs, functionSelector, payloadAuthWitness };
  }

  private getEntrypointAbi() {
    return {
      name: 'entrypoint',
      isInitializer: false,
      functionType: 'private',
      isInternal: false,
      isStatic: false,
      isOnlySelf: false,
      parameters: [{"name":"app_payload","type":{"kind":"struct","fields":[{"name":"function_calls","type":{"kind":"array","length":5,"type":{"kind":"struct","fields":[{"name":"args_hash","type":{"kind":"field"}},{"name":"function_selector","type":{"kind":"struct","fields":[{"name":"inner","type":{"kind":"integer","sign":"unsigned","width":32}}],"path":"aztec::protocol_types::abis::function_selector::FunctionSelector"}},{"name":"target_address","type":{"kind":"struct","fields":[{"name":"inner","type":{"kind":"field"}}],"path":"aztec::protocol_types::address::aztec_address::AztecAddress"}},{"name":"is_public","type":{"kind":"boolean"}},{"name":"hide_msg_sender","type":{"kind":"boolean"}},{"name":"is_static","type":{"kind":"boolean"}}],"path":"aztec::authwit::entrypoint::function_call::FunctionCall"}}},{"name":"tx_nonce","type":{"kind":"field"}}],"path":"aztec::authwit::entrypoint::app::AppPayload"},"visibility":"private"},{"name":"fee_payment_method","type":{"kind":"integer","sign":"unsigned","width":8},"visibility":"private"},{"name":"cancellable","type":{"kind":"boolean"},"visibility":"private"},{"name":"password","type":{"kind":"field"},"visibility":"private"}],
      returnTypes: [],
      errorTypes: {},
    } as FunctionAbi;
  }
}

export class PasswordAccountInterface extends BaseAccount {
  constructor(
    authWitnessProvider: AuthWitnessProvider,
    address: CompleteAddress,
    password: Fr,
  ) {
    super(
      new PasswordAccountEntrypoint(address.address, authWitnessProvider, password),
      authWitnessProvider,
      address,
    );
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

  // This account has no immutables folded into its address (it is deployed via an on-chain
  // initializer), so there is no immutables hash to commit.
  getImmutablesHash(): Promise<Fr | undefined> {
    return Promise.resolve(undefined);
  }

  getAccount(address: CompleteAddress): Account {
    return new PasswordAccountInterface(this.getAuthWitnessProvider(address), address, this.password);
  }
}

export class PasswordAuthWitnessProvider implements AuthWitnessProvider {
  constructor(private password: Fr) {}

  async createAuthWit(messageHash: Fr): Promise<AuthWitness> {
    return new AuthWitness(messageHash, [this.password]);
  }
}
