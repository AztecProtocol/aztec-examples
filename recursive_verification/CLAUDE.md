# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Aztec-Noir project that demonstrates proof verification in Aztec contracts. It uses Aztec version 3.0.0-devnet.4 to verify Noir proofs within smart contracts on the Aztec network.

The project consists of:

- A Noir circuit (`hello_circuit`) that proves x ≠ y
- An Aztec smart contract (`ValueNotEqual`) that verifies the proof on-chain
- Scripts to generate proof data and deploy/interact with the contract

## Common Development Commands

### Environment Setup

```bash
# Install dependencies
bun install

# Install/update Aztec tools
aztec-up

# Start Aztec Sandbox (required for contract deployment)
aztec start --sandbox
```

### Circuit Development

```bash
# Compile the Noir circuit
cd circuit && aztec-nargo compile

# Execute the circuit (generate witness)
cd circuit && nargo execute

# Run circuit tests
cd circuit && nargo test
```

### Contract Development

```bash
# Compile contract, postprocess, and generate TypeScript bindings
bun ccc
# This runs: cd contract && aztec-nargo compile && aztec-postprocess-contract && aztec codegen target -o artifacts

# Generate proof data (vk, proof, public inputs) for contract verification
bun data
# This runs: bun run scripts/generate_data.ts

# Deploy contract and run proof verification
bun recursion
# This runs: bun run scripts/run_recursion.ts
```

## Architecture

### Circuit (`circuit/`)

- **`src/main.nr`**: Simple circuit that asserts two field values are not equal
- **`target/hello_circuit.json`**: Compiled circuit bytecode and ABI
- Uses UltraHonk proving system for proof generation

### Contract (`contract/`)

- **`src/main.nr`**: Aztec smart contract with:
  - `initialize()`: Sets up counter with initial value for an owner
  - `increment()`: Verifies a Noir proof and increments the counter
  - `get_counter()`: Reads current counter value for an owner
- Uses Honk proof verification (457 field elements for proof, 115 for verification key)
- Stores private counters using `EasyPrivateUint` from Aztec-nr libraries

### Scripts (`scripts/`)

- **`generate_data.ts`**:

  - Executes the circuit with inputs (x=1, y=2)
  - Generates UltraHonk proof using Barretenberg backend
  - Serializes proof, verification key, and public inputs to `data.json`

- **`run_recursion.ts`**:
  - Connects to Aztec PXE at localhost:8080
  - Deploys the ValueNotEqual contract
  - Calls `increment()` with the generated proof data
  - Verifies the proof on-chain and updates the counter

### Data Flow

1. Circuit compilation produces bytecode (`hello_circuit.json`)
2. `generate_data.ts` creates proof data from circuit execution
3. Contract compilation produces Aztec contract artifact and TypeScript bindings
4. `run_recursion.ts` deploys contract and submits proof for on-chain verification

## Key Dependencies

- `@aztec/aztec.js`: Aztec SDK for contract deployment and interaction
- `@aztec/bb.js`: Barretenberg backend for proof generation
- `@aztec/noir-noir_js`: Noir.js for circuit execution
- `bun`: JavaScript runtime and package manager

## Testing

- Circuit tests: Use `nargo test` in the circuit directory
- Contract verification: Run the full flow with `bun recursion` after starting the sandbox
