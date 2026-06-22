# Recursive Verification Tests

This directory contains tests for the recursive verification proof system using Vitest.

## Prerequisites

1. Ensure the Aztec local network is running:
```bash
aztec start --local-network
```

2. Compile the contracts and generate proof data:
```bash
# Compile the Noir circuit
cd ../circuit && aztec-nargo compile && cd ..

# Compile contract and generate TypeScript bindings
yarn ccc

# Generate proof data (creates data.json)
yarn data
```

## Running Tests

Run all tests:
```bash
yarn test
```

Run tests in watch mode (re-runs on file changes):
```bash
yarn vitest
```

Run a specific test file:
```bash
yarn vitest run recursive_verification.test.ts
```

## Test Coverage

The test suite covers:

1. **Contract Deployment**: Verifies the ValueNotEqual contract deploys successfully
2. **Proof Verification**: Tests that valid proofs are accepted and counter increments
3. **Counter State**: Ensures counter values persist and update correctly
4. **Multiple Increments**: Verifies the contract can process multiple proofs
5. **User Isolation**: Tests that different users maintain separate counters
6. **Invalid Proof Rejection**: Ensures invalid proofs are rejected

## Test Structure

Each test case:
- Uses a 10-minute timeout to accommodate proof generation/verification time
- Includes proper assertions using Vitest's expect API
- Logs important information for debugging
- Handles async operations properly

## Debugging

If tests fail:

1. Check the Aztec local network is running: `aztec status`
2. Verify proof data exists: `ls ../data.json`
3. Ensure contracts are compiled: `ls ../contract/artifacts/`
4. Check PXE connection at http://localhost:8080

## Notes

- Tests require the Aztec local network to be running at `http://localhost:8080`
- Proof verification can take 10-30 seconds depending on system resources
- The test suite uses the same proof data (`data.json`) as the original script
- Each test is independent and can be run in isolation