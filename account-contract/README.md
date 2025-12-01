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

Start the local network:

```bash
aztec start --local-network
```

Deploy the account contract to the local network:

```bash
npx tsx deploy-account-contract.ts
```

### Use the account contract as normal

## Security Considerations

- The password is hashed using Poseidon2 before storage
- Password is required for every transaction (no caching)
- Password is included in transaction data (encrypted in private state)
- This is a demonstration contract - production use should consider additional security measures
- Consider using signature-based accounts for most production use cases

## Important Considerations

When implementing custom account contracts in Aztec, be aware of these critical points:

### All Execution Starts in Private

**This is the most important gotcha**: In Aztec, all transaction execution begins in the private context, even if your contract only has public functions. The account contract's `entrypoint` function always executes in private first.

- Your `entrypoint` function must be a `private` or `unconstrained private` function
- Even when calling public functions on other contracts, the call originates from private execution
- Authentication logic in the entrypoint runs in the private context
- If you need to validate anything on-chain, you must enqueue public calls and handle them accordingly

### Password/Secret Storage

- **Never store passwords in plain text**: Always hash sensitive data before storage (like we do with Poseidon2)
- The `hashed_password` is stored in `PublicImmutable` storage, meaning it's visible on-chain but cannot be changed
- Consider whether your authentication secret should be changeable (would require mutable storage)

### Entrypoint Function Signature

- The entrypoint must match the expected signature for account contracts
- It receives the payload (functions to call) and fee payment options

### State Management

- Private state is encrypted and only visible to those with the viewing key
- Public state is visible to everyone on-chain
- Choose storage types carefully: `PublicImmutable`, `PublicMutable`, `PrivateImmutable`, `PrivateMutable`, `PrivateSet`, etc.
- Changing storage types after deployment requires a new contract deployment

### Transaction Construction

- Account contracts need TypeScript integration for proper transaction construction
- You must implement the `AccountContract`, `AccountInterface`, and custom entrypoint classes
- The entrypoint class handles encoding your authentication mechanism into the transaction payload
- Mismatches between Noir and TypeScript implementations will cause authentication failures

### Testing and Debugging

- Private execution errors can be harder to debug since execution details aren't always visible
- Test thoroughly with different fee payment methods
- Ensure your authentication mechanism works for both direct calls and authwit flows

### Gas and Fee Considerations

- Account contracts are responsible for paying transaction fees
- You must handle the fee payment method selection properly
- Failed fee payments will cause the entire transaction to fail
- Consider how users will fund their account contracts with Fee Asset

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
