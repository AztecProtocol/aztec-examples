#!/bin/bash

# Setup script to download the Token contract and compile the workspace
# This downloads the token_contract from aztec-standards and compiles both contracts

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEPS_DIR="$PROJECT_DIR/.deps"
TOKEN_REPO="https://github.com/defi-wonderland/aztec-standards"
TOKEN_BRANCH="dev"

echo "=== Setting up Token contract for integration tests ==="

# Create deps directory
mkdir -p "$DEPS_DIR"

# Clone just the token_contract folder using sparse checkout
if [ -d "$DEPS_DIR/token_contract" ]; then
    echo "Token contract already exists, skipping clone..."
else
    echo "Cloning token_contract from aztec-standards..."
    cd "$DEPS_DIR"
    git clone --filter=blob:none --sparse --branch "$TOKEN_BRANCH" "$TOKEN_REPO" token_contract_repo
    cd token_contract_repo
    git sparse-checkout set src/token_contract
    # Move the token_contract out and clean up
    mv src/token_contract ../token_contract
    cd ..
    rm -rf token_contract_repo
fi

# Compile the workspace (both contracts)
echo "Compiling workspace (StreamingPayments + Token)..."
cd "$PROJECT_DIR"
aztec compile --workspace

# Generate TypeScript bindings for both contracts
echo "Generating TypeScript bindings..."
mkdir -p "$PROJECT_DIR/artifacts"
aztec codegen "$PROJECT_DIR/target" -o "$PROJECT_DIR/artifacts"

echo ""
echo "=== Setup complete! ==="
echo "Artifacts: $PROJECT_DIR/target/"
echo "TypeScript bindings: $PROJECT_DIR/artifacts/"
echo ""
echo "You can now run the integration tests with: npm test"
