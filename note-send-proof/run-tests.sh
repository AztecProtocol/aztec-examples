#!/bin/bash
# Script to run the full test suite for note-send-proof

set -e  # Exit on error

echo "========================================="
echo "Note Send Proof Test Runner"
echo "========================================="

# Check if Aztec sandbox is running
echo ""
echo "Checking Aztec local network status..."
if ! curl -s http://localhost:8080/status > /dev/null 2>&1; then
    echo "❌ Aztec local network is not running!"
    echo "Please start it with: aztec start --local-network"
    exit 1
else
    echo "✅ Aztec local network is running"
fi

# Compile the Aztec contract
echo ""
echo "Compiling Aztec contract..."
cd sample-contract && aztec compile && cd ..
echo "✅ Contract compiled"

# Generate TypeScript bindings
echo ""
echo "Generating TypeScript bindings..."
yarn ccc
echo "✅ TypeScript bindings generated"

# Generate note hash data
echo ""
echo "Generating note hash data..."
yarn data
echo "✅ Note hash data generated (data.json)"

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
