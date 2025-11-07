# Recursive Verification Tests

This directory contains tests for the recursive verification proof system using Bun's built-in test runner.

## Prerequisites

1. Ensure the Aztec sandbox is running:
```bash
aztec start --sandbox
```

2. Compile the contracts and generate proof data:
```bash
# Compile the Noir circuit
cd ../circuit && aztec-nargo compile && cd ..

# Compile contract and generate TypeScript bindings
bun ccc

# Generate proof data (creates data.json)
bun data
```

## Running Tests

Run all tests:
```bash
bun test
```

Run tests in watch mode (re-runs on file changes):
```bash
bun test:watch
```

Run a specific test file:
```bash
bun test recursive_verification.test.ts
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
- Uses a 60-second timeout to accommodate proof verification time
- Includes proper assertions using Bun's expect API
- Logs important information for debugging
- Handles async operations properly

## Debugging

If tests fail:

1. Check the Aztec sandbox is running: `aztec status`
2. Verify proof data exists: `ls ../data.json`
3. Ensure contracts are compiled: `ls ../contract/artifacts/`
4. Check PXE connection at http://localhost:8080

## Notes

- Tests require the Aztec sandbox to be running at `http://localhost:8080`
- Proof verification can take 10-30 seconds depending on system resources
- The test suite uses the same proof data (`data.json`) as the original script
- Each test is independent and can be run in isolation