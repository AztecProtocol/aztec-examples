# Note Hash Creation and Proof of Delivery

A demonstration of creating private notes in Aztec smart contracts and computing their cryptographic note hashes. This project showcases how to create notes, track their lifecycle, and verify the correct computation of note hashes including siloing and uniqueness guarantees.

## Overview

This project implements:

- **Aztec Contract**: A smart contract that creates private notes for users
- **Note Hash Computation**: Scripts to compute note hashes, siloed note hashes, and unique note hashes
- **Note Tracking**: Demonstration of how notes are created, stored, and retrieved in Aztec
- **Hash Verification**: Verification that computed note hashes match on-chain note hashes

**Aztec Version**: `2.0.3`

## Prerequisites

- [Node.js](https://nodejs.org/) (v20 or higher)
- [Aztec CLI](https://docs.aztec.network/getting_started/quickstart) (version 2.0.3)
- Linux/macOS (Windows users can use WSL2)

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
npm install
```

### Install Aztec CLI:

```bash
bash -i <(curl -s https://install.aztec.network)
```

### Set Aztec to the correct version:

```bash
aztec-up 2.0.3
```

This ensures compatibility with the contract dependencies.

## Build & Compile

### 1. Compile the Aztec Contract

```bash
cd sample-contract && aztec-nargo compile && cd ..
```

This compiles `sample-contract/src/main.nr` and generates the contract artifacts.

### 2. Post-process Contract and Generate TypeScript Bindings

```bash
npm run ccc
```

This command:

- Compiles the Aztec contract (if not already compiled)
- Post-processes for Aztec deployment
- Generates TypeScript bindings in `contract/artifacts/`

## Generate Note Hash Data

Create a note and compute all related hashes:

```bash
npm run data
```

This runs `scripts/generate_data.ts` which:

- Connects to the Aztec sandbox
- Deploys the GettingStarted contract
- Creates a private note for a user with value 69
- Computes the note hash components:
  - Commitment (from owner, randomness, and storage slot)
  - Note hash (from commitment and value)
  - Siloed note hash (scoped to contract address)
  - Unique note hash (with nonce for uniqueness)
- Verifies computed hash matches the on-chain note hash
- Saves all data to `data.json`

## Deploy and Create Notes

### 1. Start Aztec Sandbox

Start the local Aztec network:

```bash
aztec start --sandbox
```

Keep this running in a separate terminal. The sandbox runs at `http://localhost:8080`.

### 2. Create Note and Generate Data

```bash
npm run create-note
```

This is an alias for `npm run data` and runs the same workflow.

Expected output:

```
CONTRACT DEPLOYED AT 0x...
TX REQUEST HASH 0x...
TX HASH 0x...
NOTE HASH 0x...
COMPUTED UNIQUE NOTE HASH 0x...
ACTUAL UNIQUE NOTE HASH 0x...
```

## Complete Workflow

For a fresh setup, run these commands in order:

```bash
# 1. Install dependencies
npm install

# 2. Setup Aztec
aztec-up 2.0.3

# 3. Compile contract
cd sample-contract && aztec-nargo compile && cd ..

# 4. Generate TypeScript bindings
npm run ccc

# 5. Start sandbox (in a new terminal)
aztec start --sandbox

# 6. Create note and generate data (in original terminal)
npm run data
```

## Testing

### Run All Tests

The project includes a comprehensive test suite for contract deployment, note creation, and hash computation:

```bash
# Run all tests
npm test

# Run tests in watch mode for development
npm run test:watch

# Run full test suite locally (includes compilation)
./run-tests.sh
```

### Integration Tests

The test suite (`tests/note_creation.test.ts`) includes:
- Contract deployment verification
- Note creation and hash computation tests
- Verification that computed hashes match on-chain hashes
- Multiple note creation for same user
- Note creation for different users
- Note viewing and retrieval

## Troubleshooting

### Common Issues

1. **"Cannot find module './contract/artifacts/GettingStarted'"**

   - Run `npm run ccc` to generate the contract artifacts

2. **"Cannot find txEffect from tx hash"**

   - Ensure the transaction was successfully mined
   - Check the Aztec sandbox logs for errors

3. **"Failed to connect to PXE"**

   - Ensure the Aztec sandbox is running: `aztec start --sandbox`
   - Check it's accessible at `http://localhost:8080`

4. **Hash mismatch errors**

   - Ensure the NOTE_RANDOMNESS value matches what was used in contract (6969)
   - Verify the contract was compiled correctly
   - Check that you're using the correct storage slot computation

5. **TypeScript/Module errors**
   - Run `npm install` to ensure all dependencies are installed
   - Clear the dist folder: `rm -rf dist`
   - Recompile with `npm run ccc`

### Clean Rebuild

If you encounter issues, try a clean rebuild:

```bash
# Remove generated files
rm -rf sample-contract/target contract/artifacts data.json dist

# Rebuild everything
cd sample-contract && aztec-nargo compile && cd ..
npm run ccc
npm run data
```

## How It Works

1. **Contract**: The GettingStarted contract creates private notes with UintNote
2. **Note Creation**: Notes are created with a fixed randomness (6969) for reproducibility
3. **Hash Computation**:
   - Commitment = Poseidon2Hash(owner, randomness, storage_slot)
   - Note Hash = Poseidon2Hash(commitment, value)
   - Siloed Hash = Poseidon2Hash(contract_address, note_hash)
   - Unique Hash = Poseidon2Hash(nonce, siloed_hash)
4. **Verification**: The computed unique note hash is compared against the on-chain value

## Note Hash Components

The note hash computation involves several steps:

- **Storage Slot**: Derived from the map key (user address) and base slot
- **Commitment**: Hash of owner address, randomness, and storage slot
- **Note Hash**: Hash of commitment and note value
- **Note Hash Nonce**: Computed from the first nullifier and note index
- **Siloed Note Hash**: Contract-scoped hash for isolation
- **Unique Note Hash**: Final hash with nonce for uniqueness guarantee

## Available Scripts

- `npm run ccc`: Compile contract and generate TypeScript artifacts
- `npm run data`: Create note and generate hash data
- `npm run create-note`: Alias for `npm run data`
- `npm test`: Run integration test suite
- `npm run test:watch`: Run tests in watch mode for development
- `npm run clean`: Remove generated data files
- `./run-tests.sh`: Run full test suite locally (includes compilation)

## Resources

- [Aztec Documentation](https://docs.aztec.network/)
- [Noir Language Documentation](https://noir-lang.org/)
- [Aztec Note Hash Computation](https://docs.aztec.network/protocol-specs/state/note-hash-tree)

## Related Examples

- [recursive_verification](../recursive_verification/) - Demonstrates Noir proof verification in Aztec contracts
