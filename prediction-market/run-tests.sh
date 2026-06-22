#!/bin/bash
set -e

echo "=== Prediction Market Contract Tests ==="
echo ""

# Check if the local network is running
if ! curl -s http://localhost:8080/status >/dev/null 2>&1; then
    echo "Error: Aztec local network is not running!"
    echo "Please start it with: aztec start --local-network"
    exit 1
fi

echo "1. Cleaning previous builds..."
rm -rf target artifacts

echo ""
echo "2. Running Noir unit tests..."
aztec test

echo ""
echo "3. Compiling contract..."
aztec compile

echo ""
echo "4. Generating TypeScript bindings..."
aztec codegen target -o artifacts

echo ""
echo "5. Installing dependencies..."
yarn install

echo ""
echo "6. Running end-to-end tests..."
yarn test

echo ""
echo "=== All tests passed! ==="
