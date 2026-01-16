#!/bin/bash
# Script to run the full test suite for recursive verification

set -e  # Exit on error

echo "========================================="
echo "Recursive Verification Test Runner"
echo "========================================="

# Check if Aztec local network is running
echo ""
echo "Checking Aztec local network status..."
if ! curl -s http://localhost:8080/status > /dev/null 2>&1; then
    echo "❌ Aztec local network is not running!"
    echo "Please start it with: aztec start --local-network"
    exit 1
else
    echo "✅ Aztec local network is running"
fi

# Compile the Noir circuit
echo ""
echo "Compiling Noir circuit..."
cd circuit && aztec-nargo compile && cd ..
echo "✅ Circuit compiled"

# Compile the Aztec contract
echo ""
echo "Compiling Aztec contract and generating TypeScript bindings..."
yarn ccc
echo "✅ Contract compiled and bindings generated"

# Generate proof data
echo ""
echo "Generating proof data..."
yarn data
echo "✅ Proof data generated (data.json)"

# Run the tests
echo ""
echo "========================================="
echo "Running test suite..."
echo "========================================="
echo ""
yarn test

echo ""
echo "========================================="
echo "✅ All tests completed!"
echo "========================================="