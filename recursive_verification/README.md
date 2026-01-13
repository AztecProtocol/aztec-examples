# Verify Noir Proof in Aztec Contracts

A demonstration of verifying Noir circuit proofs within Aztec smart contracts using the UltraHonk proving system. This project showcases how to generate zero-knowledge proofs off-chain with Noir and verify them on-chain in an Aztec private smart contract.

## Overview

This project implements:

- **Noir Circuit**: A simple circuit that proves two field elements are not equal (x ≠ y)
- **Aztec Contract**: A private smart contract that verifies Noir proofs and maintains a counter
- **Proof Generation**: Scripts to generate UltraHonk proofs using Barretenberg
- **On-chain Verification**: Deployment and interaction scripts for proof verification on Aztec

**Aztec Version**: `3.0.0-devnet.20251212`

## Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0 or higher)
- [Aztec CLI](https://docs.aztec.network/getting_started/quickstart) (version 3.0.0-devnet.20251212)
- Linux/macOS (Windows users can use WSL2)
- 8GB+ RAM recommended for proof generation

## Project Structure

```
.
├── circuit/              # Noir circuit that generates proofs
│   ├── src/main.nr      # Circuit logic: proves x ≠ y
│   └── Nargo.toml       # Circuit configuration
├── contract/            # Aztec smart contract
│   ├── src/main.nr     # Contract that verifies Noir proofs
│   ├── artifacts/      # Generated TypeScript bindings
│   └── Nargo.toml      # Contract configuration
├── scripts/             # TypeScript utilities
│   ├── generate_data.ts    # Generates proof, VK, and public inputs
│   └── run_recursion.ts    # Deploys contract and verifies proof
├── tests/               # Integration tests
│   └── recursive_verification.test.ts  # Comprehensive test suite
├── CLAUDE.md           # Instructions for Claude AI assistants
├── EXPLAINER.md        # Detailed technical explanation of the project
├── package.json        # Node.js package configuration
├── tsconfig.json       # TypeScript configuration
├── data.json           # Generated proof data (created by `bun data`)
└── run-tests.sh        # Local test runner script
```

## Installation

### Install dependencies:

```bash
bun install
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

### 1. Compile the Noir Circuit

```bash
cd circuit && aztec-nargo compile
```

This compiles `circuit/src/main.nr` and generates `target/hello_circuit.json` containing the circuit bytecode.

### 2. Execute the Circuit

```bash
cd circuit && aztec-nargo execute
```

Generates a witness for testing the circuit with default inputs (defined in `circuit/Prover.toml`).

### 3. Compile the Aztec Contract

```bash
bun ccc
```

This command:

- Compiles the Aztec contract (`contract/src/main.nr`)
- Post-processes for Aztec deployment
- Generates TypeScript bindings in `contract/artifacts/`

## Generate Proof Data

Generate the verification key, proof, and public inputs:

```bash
bun data
```

This runs `scripts/generate_data.ts` which:

- Executes the circuit with inputs x=1, y=2
- Generates an UltraHonk proof using Barretenberg
- Saves proof data to `data.json` (508 field elements for proof, 115 for VK)

## Deploy and Verify On-Chain

### 1. Start Aztec Local Network

Start the local Aztec network:

```bash
aztec start --local-network
```

Keep this running in a separate terminal. The local network runs at `http://localhost:8080`.

### 2. Deploy Contract and Verify Proof

```bash
bun recursion
```

This runs `scripts/run_recursion.ts` which:

- Connects to the Aztec PXE (Private eXecution Environment)
- Deploys the `ValueNotEqual` contract
- Submits the proof from `data.json` for on-chain verification
- Increments the counter if verification succeeds
- Displays the final counter value

Expected output:

```
Contract Deployed at address 0x...
Tx hash: 0x...
Counter value: 11
```

## Complete Workflow

For a fresh setup, run these commands in order:

```bash
# 1. Install dependencies
bun install

# 2. Setup Aztec
aztec-up 3.0.0-devnet.20251212

# 3. Compile circuit
cd circuit && aztec-nargo compile && cd ..

# 4. Compile contract
bun ccc

# 5. Generate proof data
bun data

# 6. Start local network (in a new terminal)
aztec start --local-network

# 7. Deploy and verify (in original terminal)
bun recursion
```

## Testing

### Run All Tests

The project includes a comprehensive test suite for contract deployment and proof verification:

```bash
# Run all tests
bun test

# Run tests in watch mode for development
bun test:watch

# Run full test suite locally (includes compilation)
./run-tests.sh
```

### Test the Circuit

```bash
cd circuit && nargo test
```

This runs the tests defined in `circuit/src/main.nr`. The test verifies that the circuit correctly proves x ≠ y.

### Integration Tests

The test suite (`tests/recursive_verification.test.ts`) includes:

- Contract deployment verification
- Proof verification and counter increment tests
- Multi-user counter management
- Multiple proof verification rounds

## Troubleshooting

### Common Issues

1. **"Cannot find module './contract/artifacts/ValueNotEqual'"**

   - Run `bun ccc` to generate the contract artifacts

2. **"Cannot find module './data.json'"**

   - Run `bun data` to generate the proof data

3. **"Failed to connect to PXE"**

   - Ensure the Aztec local network is running: `aztec start --local-network`
   - Check it's accessible at `http://localhost:8080`

4. **"Proof verification failed"**

   - Ensure you've run `bun data` after any circuit changes
   - Verify the circuit was compiled with `cd circuit && aztec-nargo compile`

5. **Memory issues during proof generation**

   - The Barretenberg prover requires significant RAM
   - Close other applications or use a machine with more memory

6. **TypeScript/Linting errors with TxStatus**
   - Ensure you're importing `TxStatus` from `@aztec/aztec.js`
   - Use `TxStatus.SUCCESS` instead of string literal `"success"`

### Clean Rebuild

If you encounter issues, try a clean rebuild:

```bash
# Remove generated files
rm -rf circuit/target contract/target contract/artifacts data.json

# Rebuild everything
cd circuit && aztec-nargo compile && cd ..
bun ccc
bun data
```

## How It Works

1. **Circuit**: The Noir circuit in `circuit/src/main.nr` creates a zero-knowledge proof that two values are not equal
2. **Proof Generation**: Barretenberg generates an UltraHonk proof from the circuit execution
3. **Contract**: The Aztec contract uses `bb_proof_verification::verify_honk_proof` to verify the proof on-chain
4. **VK Hash Storage**: The verification key hash is stored in contract storage during initialization and read during proof verification
5. **Counter Management**: The contract maintains public counters per user using `PublicMutable` storage

## Additional Scripts

- `bun ccc`: Compile contract and generate TypeScript artifacts
- `bun data`: Generate proof data (verification key, proof, public inputs)
- `bun recursion`: Deploy contract and verify proof on-chain
- `bun test`: Run integration test suite
- `bun test:watch`: Run tests in watch mode for development
- `./run-tests.sh`: Run full test suite locally (includes compilation)

## Resources

- [Aztec Documentation](https://docs.aztec.network/)
- [Noir Language Documentation](https://noir-lang.org/)
- [Barretenberg Proving System](https://github.com/AztecProtocol/barretenberg)

h/t @satyambnsal for the initial implementation.
