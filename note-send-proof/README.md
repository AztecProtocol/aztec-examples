# Note Hash Creation and Proof of Delivery

A demonstration of creating private notes in Aztec smart contracts and computing their cryptographic note hashes. This project showcases how to create notes, track their lifecycle, and verify the correct computation of note hashes including siloing and uniqueness guarantees.

## Overview

This project implements:

- **Aztec Contract**: A smart contract that creates private notes for users
- **Note Hash Computation**: Scripts to compute note hashes, siloed note hashes, and unique note hashes
- **Note Tracking**: Demonstration of how notes are created, stored, and retrieved in Aztec
- **Hash Verification**: Verification that computed note hashes match on-chain note hashes

**Aztec Version**: `3.0.0-devnet.20251212`

## Prerequisites

- [Node.js](https://nodejs.org/) (v20 or higher)
- [Aztec CLI](https://docs.aztec.network/getting_started/quickstart)
- [Yarn](https://yarnpkg.com/) package manager
- Linux/macOS (Windows users can use WSL2)

To set the correct Aztec version:

```bash
aztec-up 3.0.0-devnet.20251212
```

## Project Structure

```
.
├── sample-contract/      # Aztec smart contract
│   ├── src/main.nr      # GettingStarted contract with note creation
│   └── Nargo.toml       # Contract configuration
├── contract/
│   └── artifacts/       # Generated TypeScript bindings
├── circuits/            # Noir circuit (if needed for future extensions)
│   ├── src/main.nr     # Circuit logic
│   └── Nargo.toml      # Circuit configuration
├── scripts/             # TypeScript utilities
│   ├── generate_data.ts # Creates notes and computes note hashes
│   └── create_note.ts   # Alias for generate_data.ts
├── tests/               # Integration tests
│   └── note_creation.test.ts  # Comprehensive test suite
├── package.json         # Node.js package configuration
├── tsconfig.json        # TypeScript configuration
├── jest.config.js       # Jest test configuration
├── data.json           # Generated note hash data (created by `npm run data`)
└── run-tests.sh        # Local test runner script
```

## Installation

### Install dependencies:

```bash
yarn install
```

### Install Aztec CLI:

```bash
bash -i <(curl -s https://install.aztec.network)
```

### Set Aztec to the correct version:

```bash
aztec-up 3.0.0-devnet.20251212
```

This ensures compatibility with the contract dependencies.

## Build & Compile

### Compile the Aztec Contract and Generate TypeScript Bindings

```bash
yarn ccc
```

This command:

- Compiles the Aztec contract using `aztec compile`
- Generates TypeScript bindings in `contract/artifacts/`

## Running the Example

### 1. Start Aztec Local Network

Start the local Aztec network:

```bash
aztec start --local-network
```

Keep this running in a separate terminal. The network runs at `http://localhost:8080`.

## Complete Workflow

For a fresh setup, run these commands in order:

```bash
# 1. Install dependencies
yarn install

# 2. Setup Aztec
aztec-up 3.0.0-devnet.20251212

# 3. Compile contract and generate TypeScript bindings
yarn ccc

# 4. Start local network (in a new terminal)
aztec start --local-network

# 5. Run tests (in original terminal)
yarn test
```

## Testing

### Run All Tests

The project includes a comprehensive test suite for contract deployment and note creation:

```bash
# Run all tests
yarn test
```

### Integration Tests

The test suite (`tests/note_creation.test.ts`) includes:
- Contract deployment verification
- Note creation with balance tracking
- Multiple note accumulation for same user

## Troubleshooting

### Common Issues

1. **"Cannot find module './contract/artifacts/GettingStarted'"**

   - Run `yarn ccc` to generate the contract artifacts

2. **"Failed to connect to PXE" or Network Errors**

   - Ensure the Aztec local network is running: `aztec start --local-network`
   - Check it's accessible at `http://localhost:8080`

3. **"NAPI binary not found for current platform"**

   - This is a known issue with `@aztec/bb.js`. The postinstall script should fix it automatically.
   - If the issue persists, run: `rm -f node_modules/@aztec/bb.js/dest/node-cjs/package.json`

4. **TypeScript/Module errors**
   - Run `yarn install` to ensure all dependencies are installed
   - Recompile with `yarn ccc`

### Clean Rebuild

If you encounter issues, try a clean rebuild:

```bash
# Remove generated files
rm -rf sample-contract/target contract/artifacts node_modules

# Rebuild everything
yarn install
yarn ccc
yarn test
```

## How It Works

1. **Contract**: The GettingStarted contract creates private notes using the BalanceSet pattern
2. **Note Creation**: Notes are created for the message sender with a specified value
3. **Balance Tracking**: The BalanceSet aggregates note values to track user balances
4. **Message Delivery**: Notes are delivered using `MessageDelivery.UNCONSTRAINED_ONCHAIN`

## Available Scripts

- `yarn ccc`: Compile contract and generate TypeScript artifacts
- `yarn test`: Run integration test suite
- `yarn clean`: Remove generated data files

## Resources

- [Aztec Documentation](https://docs.aztec.network/)
- [Noir Language Documentation](https://noir-lang.org/)
- [Aztec Note Hash Computation](https://docs.aztec.network/protocol-specs/state/note-hash-tree)

## Related Examples

- [recursive_verification](../recursive_verification/) - Demonstrates Noir proof verification in Aztec contracts
