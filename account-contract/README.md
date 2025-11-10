# Password Account Contract

A custom Aztec account contract that uses password-based authentication instead of traditional signature-based authentication. This example demonstrates how to implement a custom account contract with the Aztec protocol.

## Overview

This project implements a password-protected account contract for Aztec, showcasing how to create custom authentication logic for account contracts. Instead of using cryptographic signatures, transactions are authorized using a password hashed with Poseidon2.

## Features

- **Password-based Authentication**: Uses Poseidon2 hash for secure password verification
- **Custom Account Entrypoint**: Implements a custom entrypoint interface for transaction execution
- **Fee Payment Support**: Supports multiple fee payment methods (external, pre-existing FeeJuice, FeeJuice with claim)
- **Authorization Witnesses**: Implements authwit verification for cross-contract calls
- **Cancellable Transactions**: Optional transaction cancellation through nullifiers
- **TypeScript Integration**: Complete TypeScript SDK for deployment and interaction

## Contract Architecture

### Core Contract (`PasswordAccount`)

The main contract implements:

- **constructor(password: Field)**: Initializes the account with a hashed password
- **entrypoint(...)**: Main entrypoint for executing transactions with password authentication
- **verify_private_authwit(...)**: Verifies authorization witnesses for cross-contract calls
- **lookup_validity(...)**: Unconstrained function to check authwit validity

### Storage

```noir
struct Storage<Context> {
    hashed_password: PublicImmutable<Field, Context>,
}
```

The contract stores only the Poseidon2 hash of the password in public state.

### Account Actions

The `AccountActions` module provides:

- Transaction entrypoint logic with fee payment handling
- Authorization witness verification
- Support for cancellable transactions via nullifiers

## TypeScript Integration

### PasswordAccountContract

Implements the `AccountContract` interface for easy deployment:

```typescript
const passwordAccountContract = new PasswordAccountContract(
  new Fr(your_password)
);
```

### PasswordAccountInterface

Provides the account interface for creating transactions:

```typescript
const accountInterface = new PasswordAccountInterface(
  authWitnessProvider,
  address,
  chainInfo,
  password
);
```

### PasswordAccountEntrypoint

Handles transaction construction with custom entrypoint parameters:

```typescript
const entrypoint = new PasswordAccountEntrypoint(
  address,
  auth,
  password,
  chainId,
  version
);
```

## Building

Compile the Noir contract:

```bash
aztec-nargo compile
```

Install TypeScript dependencies:

```bash
yarn install
```

## Usage

### 1. Deploy the Account Contract

```typescript
import { PasswordAccountContract } from "./ts/password-account-entrypoint";
import { Fr } from "@aztec/foundation/fields";

// Create account contract with password
const password = new Fr(123456789);
const accountContract = new PasswordAccountContract(password);

// Get artifact and initialization args
const artifact = await accountContract.getContractArtifact();
const { constructorName, constructorArgs } =
  await accountContract.getInitializationFunctionAndArgs();

// Deploy using DeployMethod
// See ts/deploy-account-contract.ts for full example
```

### 2. Create Transactions

The account contract authenticates transactions by verifying the password hash:

```typescript
// Transactions automatically include the password in the entrypoint call
// The password is hashed with Poseidon2 and compared to stored hash
```

### 3. Authorization Witnesses

For cross-contract calls requiring authorization:

```typescript
// The account can authorize actions for other contracts
// Password is used to verify the authorization
```

## Fee Payment Methods

The contract supports three fee payment options:

1. **EXTERNAL (0)**: Another contract pays the fee
2. **PREEXISTING_FEE_JUICE (1)**: Account pays with existing FeeJuice balance
3. **FEE_JUICE_WITH_CLAIM (2)**: Account pays with FeeJuice claimed in same transaction

## Security Considerations

- The password is hashed using Poseidon2 before storage
- Password is required for every transaction (no caching)
- Password is included in transaction data (encrypted in private state)
- This is a demonstration contract - production use should consider additional security measures
- Consider using signature-based accounts for most production use cases

## Dependencies

### Noir Dependencies

- **aztec**: v3.0.0-devnet.4
- **poseidon**: v0.1.1

### TypeScript Dependencies

- **@aztec/aztec.js**: 3.0.0-devnet.4
- **@aztec/accounts**: 3.0.0-devnet.4
- **@aztec/stdlib**: 3.0.0-devnet.4
- **@aztec/entrypoints**: Included in aztec.js

## Project Structure

```
account-contract/
├── Nargo.toml                        # Noir project configuration
├── package.json                      # Node.js dependencies and scripts
├── src/
│   ├── main.nr                      # Main contract implementation
│   └── account_actions.nr           # Account action handlers
└── ts/
    ├── deploy-account-contract.ts   # Deployment script
    ├── password-account-entrypoint.ts         # TypeScript entrypoint implementation
    └── password-account-contract-artifact.ts  # Contract artifact loader
```

## Learn More

- [Aztec Account Contracts](https://docs.aztec.network/developers/contracts/writing_contracts/accounts)
- [Account Abstraction in Aztec](https://docs.aztec.network/concepts/accounts/main)
- [Aztec Documentation](https://docs.aztec.network/)
- [Noir Language Documentation](https://noir-lang.org/)

## Notes

- This is an educational example demonstrating custom account contract patterns
- For production use, consider using the standard ECDSA or Schnorr signature-based accounts
- The password-based approach trades cryptographic security guarantees for simplicity
