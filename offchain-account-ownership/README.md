# Off-Chain Account Ownership Proof

This example demonstrates how to prove ownership of an Aztec account completely off-chain, without any on-chain transactions or node queries.

## Problem Statement

You want to prove you control an Aztec account with:

1. **No transactions** - purely cryptographic verification
2. **No node queries** - fully offline verification using Merkle proofs
3. **Works for any account type** - generic across Schnorr, Password, ECDSA accounts
4. **Verifier can trust the proof** - VK membership is cryptographically verified

## How It Works

### The Key Insight

Aztec contract classes commit to the verification key (VK) of each private function via a Merkle tree:

```
ContractClassId = hash(artifactHash, privateFunctionsRoot, publicBytecodeCommitment)

privateFunctionsRoot = MerkleRoot of leaves where each leaf is:
  hash(FunctionSelector, VK_Hash)
```

This means we can prove a VK belongs to a contract class using a Merkle membership proof, without querying any node.

### Solution Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              PROVER                                      │
│  1. Signs a challenge using their account's auth mechanism               │
│  2. Generates ZK proof of valid signature                                │
│  3. Generates VK membership proof from account contract artifact         │
│  4. Sends: proof, VK, VK membership proof, contract class components     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                             VERIFIER                                     │
│  1. Compute privateFunctionsRoot from VK membership proof (Merkle)       │
│  2. Recompute ContractClassId from components                            │
│  3. Verify ContractClassId matches prover's claim                        │
│  4. Verify the ZK proof                                                  │
│  5. Result: Prover controls an account of this contract class            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Trust Model

The verifier proves: **"The prover controls an account of contract class X"**

- The proof is fully self-contained and offline-verifiable
- No Aztec node queries are required
- The cryptographic binding ensures the prover cannot lie about the contract class
- If address binding is needed, verifier can optionally query node to check deployment

## Project Structure

```
offchain-account-ownership/
├── circuit/
│   ├── Nargo.toml              # Noir project config
│   └── src/
│       └── main.nr             # Schnorr signature verification circuit
├── scripts/
│   ├── generate_proof.ts       # Generate ownership proof with VK membership
│   ├── verify_proof.ts         # Verify ownership proof offline
│   └── utils/
│       ├── types.ts            # Type definitions
│       ├── contract_class.ts   # Contract class and Merkle utilities
│       └── index.ts            # Utility exports
├── tests/
│   └── ownership_proof.test.ts # Integration tests
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

# Install Node.js (v22+) and Yarn
npm install -g yarn
```

## Usage

### 1. Install Dependencies

```bash
cd offchain-account-ownership
yarn install
```

### 2. Compile the Circuit

```bash
yarn compile
# or: cd circuit && nargo compile
```

### 3. Generate an Ownership Proof

```bash
yarn data
# or with account type:
yarn data --account-type schnorr
```

This will:
- Generate a random signing key pair
- Sign a random challenge
- Generate a ZK proof proving the signature is valid
- Generate a VK membership proof from the Schnorr account contract
- Output everything to `data.json`

### 4. Verify the Proof (Offline)

```bash
yarn verify
# or with specific data file:
yarn verify data.json
# or with expected challenge (for replay protection):
yarn verify data.json <expected-challenge>
```

The verifier:
1. Computes `privateFunctionsRoot` from the Merkle proof
2. Recomputes `ContractClassId` from components
3. Verifies the computed ID matches the claimed ID
4. Verifies the ZK proof
5. All done offline - no node queries!

### 5. Run Tests

```bash
yarn test
```

## Verification Output Example

```
============================================================
VERIFICATION SUMMARY
============================================================
VK Membership:     ✓ PASSED
Selector Check:    ✓ PASSED
ZK Proof:          ✓ PASSED
Account Type:      Unknown (not in registry)
------------------------------------------------------------
OVERALL:           ✓ VERIFIED

============================================================
✓ ACCOUNT OWNERSHIP VERIFIED
============================================================

The prover has demonstrated they control an account of:
  Contract Class ID: 0x045ceef8cb0a93103c0e60b83b9fdfb01e869fc6425ed690c8b5679dc06403f1
  Account Type: schnorr
  VK Hash: 0x0dcf8a8fdb795328b3582cee28eea94f9ab561eb3d51de553ecbde537967e4f6

This verification was performed completely offline.
No Aztec node queries were required.
```

## Data Structure

The proof data (`data.json`) contains:

```typescript
interface GenericOwnershipProof {
  // Contract class identification
  contractClass: {
    id: string;                      // Contract class ID
    artifactHash: string;            // Hash of contract artifact
    publicBytecodeCommitment: string; // Commitment to public bytecode
  };

  // ZK Proof
  proof: {
    rawProof: number[];
    publicInputs: string[];
  };

  // Verification Key
  vk: {
    asFields: string[];
    hash: string;
  };

  // VK membership proof (Merkle proof)
  vkMembershipProof: {
    leafPreimage: {
      selector: string;   // Function selector
      vkHash: string;     // VK hash
    };
    siblingPath: string[];  // 7 elements for tree height 7
    leafIndex: number;
  };

  // Challenge and metadata
  challenge: string;
  metadata: {
    generatedAt: string;
    accountType?: string;
    functionName: string;
  };
}
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

## Security Considerations

| Aspect | Protection |
|--------|------------|
| **VK Binding** | VK membership proof cryptographically binds proof to contract class |
| **Challenge Freshness** | Verifier should provide fresh challenge to prevent replay |
| **Contract Class ID** | Verifier recomputes from components - prover cannot lie |
| **Selector Verification** | Verified to be `verify_private_authwit` |
| **No Address Binding** | Proves "account of class X", not "account at address Y" |

### Address Binding (Optional)

If you need to verify a specific address:
1. Query node: `node_getContract(address).currentContractClassId`
2. Compare with `proofData.contractClass.id`

## Extending to Other Account Types

The architecture supports any account type. To add support:

1. Import the account contract artifact (e.g., `PasswordAccountContractArtifact`)
2. Implement the corresponding proof generation (e.g., password verification)
3. The VK membership proof generation is automatic

## Dependencies

- `@aztec/bb.js` - Barretenberg proving backend
- `@aztec/noir-noir_js` - Noir.js for circuit execution
- `@aztec/foundation` - Crypto utilities (Schnorr, poseidon2)
- `@aztec/stdlib` - Contract class and Merkle utilities
- `@aztec/accounts` - Account contract artifacts

## Related Resources

- [Aztec Documentation](https://docs.aztec.network)
- [Aztec Account Abstraction](https://docs.aztec.network/concepts/foundation/accounts)
- [Contract Classes](https://docs.aztec.network/concepts/smart-contracts/classes)
