# Off-Chain Account Ownership Proof

This example demonstrates how to prove ownership of an Aztec account completely off-chain, without any on-chain transactions.

## Problem Statement

You want to prove you control an Aztec account address with:

1. **No transactions** - verification uses only RPC calls to read state
2. **Works for any account type** - demonstrated here with Schnorr accounts
3. **Verifier can trust the proof** - the VK is committed to in the account's address derivation

## How It Works

### The Key Insight

Aztec account addresses are derived from the contract's `private_functions_root`, which includes a Merkle tree of function leaf preimages:

```
ContractClassFunctionLeafPreimage {
    selector: FunctionSelector,
    vk_hash: Field,  // VK hash for this function's circuit
}
```

This means the account address **cryptographically commits to the verification key** of each private function, including `verify_private_authwit`.

### Solution Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         PROVER                               │
│  1. Has signing private key for account                      │
│  2. Signs a random challenge                                 │
│  3. Generates ZK proof of valid signature                    │
│  4. Sends: proof, publicInputs (pubkey, challenge), VK       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        VERIFIER                              │
│  1. Verify the ZK proof                                      │
│  2. (Optional) Query Aztec node for contract class           │
│  3. Verify VK hash is in private_functions_root              │
│  4. If VK matches → account ownership proven                 │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
offchain-account-ownership/
├── circuit/
│   ├── Nargo.toml           # Noir project config
│   └── src/
│       └── main.nr          # Schnorr signature verification circuit
├── scripts/
│   ├── generate_proof.ts    # Generate ownership proof
│   └── verify_proof.ts      # Verify ownership proof
├── tests/
│   └── ownership_proof.test.ts  # Integration tests
├── package.json
└── README.md
```

## Prerequisites

```bash
# Install Aztec tools
bash -i <(curl -s https://install.aztec.network)
aztec-up 3.0.0-devnet.20251212

# Install nargo for Noir compilation
noirup -v 1.0.0-beta.15

# Install Bun
curl -fsSL https://bun.sh/install | bash
```

## Usage

### 1. Install Dependencies

```bash
cd offchain-account-ownership
bun install
```

### 2. Compile the Circuit

```bash
bun run compile
# or: cd circuit && nargo compile
```

### 3. Generate an Ownership Proof

```bash
bun run data
```

This will:
- Generate a random signing key pair
- Create a random challenge
- Sign the challenge
- Generate a ZK proof proving the signature is valid
- Output to `data.json`

### 4. Verify the Proof

```bash
bun run verify
# or with specific data file:
bun run verify data.json
```

### 5. Run Tests

```bash
bun test
```

## Circuit Details

The Noir circuit (`circuit/src/main.nr`) implements Schnorr signature verification:

```noir
fn main(
    // Public inputs - visible to verifier
    pub_key_x: pub Field,
    pub_key_y: pub Field,
    challenge: pub [u8; 32],

    // Private input - signature (not revealed)
    signature: [u8; 64],
) {
    let pub_key = EmbeddedCurvePoint { x: pub_key_x, y: pub_key_y, is_infinite: false };
    let is_valid = schnorr::verify_signature(pub_key, signature, challenge);
    assert(is_valid, "Invalid Schnorr signature");
}
```

## Trust Model

| Component | Trust Assumption |
|-----------|------------------|
| Proof | Zero-knowledge - verifier learns nothing except validity |
| VK | Committed to in account address via contract class ID |
| Challenge | Should be fresh/random to prevent replay attacks |
| Public Key | Public input - verifier sees which account is being proven |

## Full Verification (Production)

In production, the verifier would:

1. **Verify the ZK proof** - using the provided VK
2. **Fetch contract instance** - `node_getContract(accountAddress)` via RPC
3. **Get contract class** - `node_getContractClass(contractClassId)` via RPC
4. **Verify VK inclusion** - check VK hash is in `private_functions_root` for `verify_private_authwit` selector

This ensures the prover used the correct verification circuit that matches the account's actual authentication logic.

## Security Considerations

- **Challenge freshness**: Always use a fresh random challenge provided by the verifier
- **VK verification**: In production, verify the VK matches the account's contract class
- **Replay protection**: The challenge binds the proof to a specific verification request

## Dependencies

- `@aztec/bb.js` - Barretenberg proving backend
- `@aztec/noir-noir_js` - Noir.js for circuit execution
- `@aztec/foundation` - Schnorr signing utilities
- `schnorr` (Noir) - Schnorr signature verification library

## Related Resources

- [Aztec Documentation](https://docs.aztec.network)
- [Noir Schnorr Library](https://github.com/noir-lang/schnorr)
- [Aztec Account Abstraction](https://docs.aztec.network/concepts/foundation/accounts)
