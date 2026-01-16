# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a collection of Aztec smart contract examples written in Noir, designed for learning Aztec development hands-on. The repository contains multiple example projects showcasing different aspects of Aztec's zero-knowledge smart contract platform.

## Key Technologies

- **Aztec**: A privacy-first Layer 2 on Ethereum using zero-knowledge proofs
- **Noir**: A domain-specific language for writing zero-knowledge circuits
- **nargo**: The Noir compiler for compiling vanilla Noir circuits (install via [noirup](https://github.com/noir-lang/noirup))
- **aztec compile**: Aztec CLI command for compiling Aztec contracts (includes post-processing)
- **aztec-wallet**: CLI tool for interacting with Aztec contracts
- **Node.js/npm/yarn**: JavaScript runtime and package managers (Node.js v22+ recommended)

## Project Structure

```
aztec-examples/
├── recursive_verification/  # Noir proof verification in Aztec contracts example
│   ├── circuit/            # Noir circuit that generates proofs (proves x ≠ y)
│   ├── contract/          # Aztec contract that verifies Noir proofs
│   ├── scripts/           # TypeScript utilities for proof generation and deployment
│   ├── tests/             # Integration test suite
│   ├── data.json         # Generated proof data (created by `yarn data`)
│   ├── README.md         # Comprehensive documentation
│   ├── CLAUDE.md         # Project-specific AI guidance
│   ├── EXPLAINER.md      # Technical deep-dive explanation
│   └── run-tests.sh      # Local test runner script
├── starter-token/          # Token contract example with start-here and reference implementations
│   ├── start-here/        # Template for implementing a token
│   │   ├── contract/      # Noir contract code
│   │   ├── external-call-contract/  # Cross-contract calls
│   │   └── ts/           # TypeScript client code
│   └── reference/         # Complete reference implementation
│       ├── contract/      # Full token implementation
│       ├── external-call-contract/  # Cross-contract example
│       └── ts/           # TypeScript client
└── .github/              # CI/CD configuration
    └── workflows/
        └── recursive-verification-tests.yml  # Automated testing workflow
```

## Development Commands

### Prerequisites

```bash
# Install Aztec tools (required)
bash -i <(curl -s https://install.aztec.network)

# Set specific version (examples may require different versions)
aztec-up 3.0.0-devnet.6-patch.1  # For recursive_verification
```

### Building Contracts

From a contract directory containing `Nargo.toml`:

```bash
# Compile an Aztec contract (includes post-processing)
aztec compile

# For recursive_verification example (using yarn)
yarn ccc  # Compiles contract and generates TypeScript bindings
```

### Building Vanilla Noir Circuits

For vanilla Noir circuits (not Aztec contracts), install nargo separately:

```bash
# Install nargo via noirup
curl -L https://raw.githubusercontent.com/noir-lang/noirup/refs/heads/main/install | bash
noirup -v 1.0.0-beta.15

# Compile a vanilla Noir circuit
nargo compile
```

### Running Local Development Environment

```bash
# Start Aztec local network (node + PXE)
aztec start --local-network

# Start without PXE (when using aztec-wallet)
NO_PXE=true aztec start --local-network

# Import test accounts to aztec-wallet
aztec-wallet import-test-accounts
```

### Testing

```bash
# Run tests (starts TXE automatically)
aztec test

# Or manually with TXE for debug output:
# Terminal 1: Start Testing Execution Environment
aztec start --txe --port=8081

# Terminal 2: Run tests with output
nargo test --oracle-resolver http://127.0.0.1:8081 --show-output

# Run integration tests (recursive_verification)
cd recursive_verification
yarn test

# Run full test suite with compilation
./run-tests.sh
```

### Deploying and Interacting with Contracts

```bash
# Deploy a contract (without constructor)
aztec-wallet deploy --no-init target/<contract-name>.json --from test0 --alias <alias>

# Call a contract function
aztec-wallet send <function_name> --args <args...> --contract-address <alias> -f test0

# Simulate a function call (read-only)
aztec-wallet simulate <function_name> --args <args...> --contract-address <alias> -f test0

# Profile gas/gates for a function
aztec-wallet profile <function_name> --args <args...> --contract-address <alias> -f test0
```

### Performance Analysis

```bash
# Generate gate flamegraph for private functions
SERVE=1 aztec flamegraph target/<contract>.json <function_name>

# Profile gate count for deployed contract
aztec-wallet profile <function_name> --args <args...> --contract-address <alias> -f test0
```

## Example-Specific Workflows

### Recursive Verification Example

Complete workflow for the proof verification example:

```bash
# 1. Install dependencies (requires Node.js and yarn)
cd recursive_verification
yarn install

# 2. Install nargo for vanilla Noir circuit compilation
noirup -v 1.0.0-beta.15

# 3. Compile the Noir circuit
cd circuit && nargo compile && cd ..

# 4. Compile the Aztec contract
yarn ccc  # Runs: aztec compile && aztec codegen

# 5. Generate proof data (UltraHonk proof, verification key, public inputs)
yarn data  # Creates data.json with proof for x=1, y=2

# 6. Start Aztec local network (in separate terminal)
aztec start --local-network

# 7. Deploy contract and verify proof on-chain
yarn recursion  # Deploys ValueNotEqual contract and verifies proof

# 8. Run tests
yarn test

# Optional: Run circuit tests
cd circuit && nargo test
```

### Starter Token Example

```bash
# Navigate to reference implementation
cd starter-token/reference

# Build the contract
cd contract && aztec compile && cd ..

# Build and run TypeScript client
cd ts
npm install
npm run build
npm start
```

## Contract Architecture

### Aztec Contract Structure

Aztec contracts use the `#[aztec]` macro and define functions as either:

- `#[private]`: Executed client-side with zero-knowledge proofs
- `#[public]`: Executed on-chain by the protocol
- `#[initializer]`: Constructor-like functions for setup
- `#[unconstrained]`: View functions that don't modify state

Key considerations:

- **Private functions**: Optimize for circuit size (gates), unconstrained functions don't add gates
- **Public functions**: Optimize for gas cost, unconstrained functions do add cost
- **Unconstrained functions**: Used for computation that doesn't need proving, must verify results in constrained context

### Proof Verification Pattern (recursive_verification)

The recursive verification example demonstrates:

- **Off-chain proof generation**: Noir circuits compiled and executed with Barretenberg
- **On-chain verification**: Using `bb_proof_verification::verify_honk_proof` in Aztec contracts
- **UltraHonk proving system**: Generates proofs with 508 field elements, verification keys with 115 fields
- **VK Hash Storage**: Verification key hash stored in `PublicImmutable` storage, readable from private context
- **Public state management**: Using `PublicMutable` for per-user counters

### Token Pattern (starter-token)

The token example showcases:

- **Dual balance system**: Public and private token balances
- **State management**: Using `PublicMutable` and `Map` for storage
- **Access control**: Owner-based permissions for minting
- **Cross-contract calls**: External contract interactions

### Testing Pattern

Tests use the Testing Execution Environment (TXE):

```noir
use dep::aztec::test::helpers::test_environment::TestEnvironment;

#[test]
unconstrained fn test_function() {
    let mut env = TestEnvironment::new();
    let user = env.create_account_contract(1);
    env.impersonate(user);

    // Deploy and interact with contracts
    let contract = env.deploy_self("ContractName").without_initializer();
    // Test contract functions
}
```

## Dependencies

### Aztec Contract Dependencies

Aztec contracts specify dependencies in `Nargo.toml`:

```toml
[dependencies]
aztec = { git = "https://github.com/AztecProtocol/aztec-packages/", tag = "vX.X.X", directory = "noir-projects/aztec-nr/aztec" }
easy_private_state = { git = "https://github.com/AztecProtocol/aztec-packages/", tag = "vX.X.X", directory = "noir-projects/aztec-nr/easy-private-state" }
```

**Version Compatibility**: All examples use the same Aztec version:

- All examples: v3.0.0-devnet.6-patch.1

### JavaScript/TypeScript Dependencies

TypeScript projects use:

- `@aztec/aztec.js`: Aztec SDK for contract deployment and interaction
- `@aztec/accounts`: Account management for Aztec
- `@aztec/bb.js`: Barretenberg backend for proof generation (recursive_verification)
- `@aztec/noir-noir_js`: Noir.js for circuit execution (recursive_verification)

### Runtime Requirements

- **Node.js**: v22+ for all TypeScript examples
- **yarn**: Package manager for recursive_verification example
- **npm**: Package manager for starter-token example
- **Docker**: Required for running Aztec local network
- **Memory**: 8GB+ RAM recommended for proof generation

## CI/CD

The repository includes GitHub Actions workflows for automated testing:

### recursive-verification-tests.yml

Runs on:

- Push to main branch
- Pull requests modifying `recursive_verification/**`
- Manual workflow dispatch

Steps:

1. Sets up Node.js (v22) and yarn
2. Installs Aztec CLI
3. Starts Aztec local network
4. Compiles circuits and contracts
5. Generates proof data
6. Runs integration tests
7. Uploads test artifacts on failure

## Common Issues and Solutions

### Issue: "Cannot find module './contract/artifacts/'"

**Solution**: Run `yarn ccc` or `aztec compile` to generate contract artifacts

### Issue: "Failed to connect to PXE"

**Solution**: Ensure Aztec local network is running with `aztec start --local-network`

### Issue: "Proof verification failed"

**Solution**: Regenerate proof data after circuit changes with `yarn data`

### Issue: Memory issues during proof generation

**Solution**: Close other applications or use a machine with more RAM (8GB+ recommended)

### Issue: Version compatibility errors

**Solution**: Check the Aztec version required for each example and set with `aztec-up <version>`

## Best Practices

1. **Version Management**: Always check and set the correct Aztec version for each example
2. **Testing**: Run tests locally before pushing changes
3. **Documentation**: Update READMEs when modifying examples
4. **Clean Builds**: When encountering issues, try removing `target/`, `artifacts/`, and `node_modules/` directories
5. **Local Network Management**: Always ensure local network is running when deploying/testing contracts
