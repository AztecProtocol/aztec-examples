#!/usr/bin/env bash
set -euo pipefail

echo "=== Prediction Market zkTLS - Test Suite ==="
echo ""

# 1. Compile contract
echo "Step 1: Compiling contract..."
aztec compile
aztec codegen target -o artifacts
echo "  Done."
echo ""

# 2. Run Noir unit tests (CSMM pricing + price parser)
echo "Step 2: Running Noir unit tests..."
aztec test
echo "  Done."
echo ""

# 3. Run integration tests (requires local network)
echo "Step 3: Running integration tests..."
echo "  (Ensure Aztec local network is running: aztec start --local-network)"
yarn test
echo ""

echo "=== All tests complete ==="
