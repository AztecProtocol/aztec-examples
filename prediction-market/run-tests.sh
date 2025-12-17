#!/bin/bash
set -e

echo "=== Prediction Market Contract Tests ==="
echo ""

# Check if sandbox is running
if ! curl -s http://localhost:8080/status >/dev/null 2>&1; then
    echo "Error: Aztec sandbox is not running!"
    echo "Please start it with: aztec start --sandbox"
    exit 1
fi

echo "1. Cleaning previous builds..."
rm -rf target artifacts

echo ""
echo "2. Running Noir unit tests..."
aztec test

echo ""
echo "3. Compiling contract..."
aztec-nargo compile

echo ""
echo "4. Post-processing contract..."
aztec-postprocess-contract

echo ""
echo "5. Generating TypeScript bindings..."
aztec codegen target -o artifacts

echo ""
echo "6. Installing dependencies..."
bun install

echo ""
echo "7. Running end-to-end tests..."
bun test

echo ""
echo "=== All tests passed! ==="
