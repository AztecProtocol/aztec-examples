# Aztec Examples

A collection of example Aztec smart contracts and circuits written in Noir, designed for hands-on learning of the Aztec privacy-first Layer 2 blockchain.

## Overview

This repository contains practical examples demonstrating various features of Aztec's zero-knowledge smart contract platform, from basic token implementations to advanced proof verification patterns.

You can find additional examples in the Aztec monorepo [docs examples folder](https://github.com/AztecProtocol/aztec-packages/tree/next/docs/examples), including:

- Counter contract example
- A simple token example
- An NFT bridge contract example

## Examples

### 1. [Recursive Verification](./recursive_verification)

**Aztec Version**: 3.0.0-devnet.4

Demonstrates how to verify Noir circuit proofs within Aztec smart contracts using the UltraHonk proving system. This example showcases:

- Zero-knowledge proof generation from Noir circuits
- On-chain proof verification in private smart contracts
- Private state management using `EasyPrivateUint`
- Integration between off-chain proving and on-chain verification

**Key features**:

- Circuit that proves two values are not equal (x ≠ y)
- Smart contract that verifies proofs and maintains private counters
- Comprehensive test suite and GitHub Actions CI/CD pipeline
- TypeScript utilities for proof generation and contract deployment

[View README](./recursive_verification/README.md)

## Quick Start

### Install Aztec Tools

```bash
# Install the Aztec CLI and tools
bash -i <(curl -s https://install.aztec.network)

# Set specific Aztec version (if needed)
aztec-up 3.0.0-devnet.4
```

### Run the Examples

#### Recursive Verification

```bash
cd recursive_verification
bun install
bun ccc         # Compile contracts
bun data        # Generate proof data
aztec start --sandbox  # Start local network (in new terminal)
bun recursion   # Deploy and verify proof
```

#### Starter Token

```bash
cd starter-token/reference
# Follow the specific setup instructions in the token example
```

## Repository Structure

```
aztec-examples/
├── recursive_verification/     # Proof verification in contracts
│   ├── circuit/               # Noir circuit implementation
│   ├── contract/              # Aztec smart contract
│   ├── scripts/               # TypeScript utilities
│   ├── tests/                 # Integration test suite
│   └── README.md             # Detailed documentation
└── .github/                   # CI/CD workflows
    └── workflows/
        └── recursive-verification-tests.yml
```

## Development Workflow

### Common Commands

```bash
# Compile Aztec contracts
aztec-nargo compile

# Start local Aztec network
aztec start --sandbox

# Run tests with Testing Execution Environment (TXE)
aztec test

# Deploy contracts (using aztec-wallet)
aztec-wallet deploy --no-init target/<contract>.json --from test0 --alias <alias>

# Interact with contracts
aztec-wallet send <function> --args <args> --contract-address <alias> -f test0

# Profile gas/gates usage
aztec-wallet profile <function> --args <args> --contract-address <alias> -f test0
```

## Testing

### Continuous Integration

The repository includes GitHub Actions workflows that automatically test examples on pull requests and pushes to the main branch.

### Local Testing

Each example includes its own test suite:

```bash
# Recursive Verification tests
cd recursive_verification
bun test

# Run with CI-like environment
./run-tests.sh
```

## Resources

- [Aztec Documentation](https://docs.aztec.network/)
- [Noir Language Documentation](https://noir-lang.org/)
- [Aztec GitHub Repository](https://github.com/AztecProtocol/aztec-packages)
- [Barretenberg Proving System](https://github.com/AztecProtocol/barretenberg)

## Contributing

We welcome contributions! Please feel free to submit issues or pull requests with:

- New example contracts
- Improvements to existing examples
- Documentation enhancements
- Test coverage improvements

## License

[Apache License 2.0](LICENSE)
