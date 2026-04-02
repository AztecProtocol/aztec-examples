# zkTLS Airdrop: Private Token Distribution for Primus Labs Contributors

An Aztec smart contract example that distributes airdrop tokens to verified contributors of the [primus-labs](https://github.com/primus-labs) GitHub organization. Contributors prove their status privately using a [Primus zkTLS](https://docs.primuslabs.xyz/) attestation of the GitHub API. The airdrop mints tokens via the [defi-wonderland/aztec-standards](https://github.com/defi-wonderland/aztec-standards) Token contract — the entire claim flow is private.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                  1. ATTESTATION GENERATION (off-chain)          │
│                                                                 │
│  User ──► Primus SDK ──► GitHub API                             │
│             │              │                                    │
│             │  attestor verifies HTTPS response                 │
│             │  signs with ECDSA secp256k1                       │
│             ▼                                                   │
│  attestation.json (signature, URL, SHA256 hashes, plaintext)    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              2. PRIVATE CLAIM (single private function)         │
│                                                                 │
│  ┌─ Verify attestation ─────────────────────────────────────┐   │
│  │  ECDSA signature verification (secp256k1)                │   │
│  │  URL prefix matching against allowed list                │   │
│  │  SHA256(plaintext) == data_hash for each field           │   │
│  │  Assert username + ID match claimed identity             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─ Double-claim prevention ────────────────────────────────┐   │
│  │  claim_nullifier = Poseidon2(github_id_bytes)            │   │
│  │  push_nullifier(claim_nullifier)                         │   │
│  │  Protocol rejects duplicate nullifiers automatically     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─ Token mint (cross-contract call) ───────────────────────┐   │
│  │  Token::at(token).mint_to_private(claimer, amount)       │   │
│  │  Creates encrypted UintNote in Token contract            │   │
│  │  Only succeeds because Token.minter == airdrop address   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Privacy guarantees:**
- GitHub username and ID are verified in private and never appear on-chain
- The claim nullifier is siloed by the contract address — cannot be linked to the raw GitHub ID
- Token balances are encrypted private notes in the Token contract — only the owner can read them
- External observers cannot determine who claimed or individual balances

## Prerequisites

```bash
# Install Aztec tools
bash -i <(curl -s https://install.aztec.network)
aztec-up 4.2.0-aztecnr-rc.2

# Node.js v22+ and yarn
node --version  # v22.x
```

## Project Structure

```
zktls-airdrop/
├── contract/                    # PrimusAirdrop Aztec contract
│   ├── src/main.nr             # Airdrop logic + cross-contract Token mint
│   ├── Nargo.toml              # Deps: aztec, att_verifier_lib, token_contract
│   ├── target/                 # Compiled artifacts (generated)
│   └── artifacts/              # TypeScript bindings (generated)
├── scripts/
│   ├── generate_attestation.ts # Generate zkTLS attestation via Primus SDK
│   ├── parse_attestation.ts    # Parse attestation JSON → contract inputs
│   ├── compute_url_hashes.ts   # Compute Poseidon2 hashes for allowed URLs
│   ├── deploy_and_claim.ts     # Full deploy + claim workflow
│   └── sponsored_fpc.ts        # Fee payment helper
├── tests/
│   └── airdrop.test.ts         # Integration tests (vitest)
├── testdata/
│   └── sample-attestation.json # Example attestation structure
├── package.json
├── tsconfig.json
└── README.md
```

## Quick Start

### 1. Install Dependencies

```bash
cd zktls-airdrop
yarn install
```

### 2. Compile the Contract

```bash
yarn ccc
# Compiles contract and generates TypeScript bindings
```

### 3. Generate an Attestation

You need Primus API credentials from [dev.primuslabs.xyz](https://dev.primuslabs.xyz).

```bash
# Install the optional Primus SDK
yarn add @primuslabs/zktls-js-sdk

# Generate an attestation proving you're a contributor to a primus-labs repo
PRIMUS_APP_ID=your_id PRIMUS_APP_SECRET=your_secret \
  yarn generate zktls-js-sdk your_github_username
```

This creates `testdata/attestation.json` containing the signed attestation.

### 4. Start the Aztec Local Network

```bash
# In a separate terminal
aztec start --local-network
```

### 5. Deploy and Claim

```bash
yarn claim
# or with a specific attestation file:
yarn claim testdata/attestation.json
```

The deployment script performs three steps:
1. **Deploy PrimusAirdrop** with URL hashes and airdrop amount
2. **Deploy Token** with `constructor_with_minter(minter = airdrop.address)`
3. **Link** via `airdrop.set_token(token.address)` (one-time initialization)

Then it parses the attestation and submits a private claim.

## Contract API

### `constructor(deployer, allowed_url_hashes, airdrop_amount)` — Public (once)

Deploys the airdrop with immutable configuration.

### `set_token(token)` — Public (once, deployer only)

Links the airdrop to its Token contract. Uses `PublicImmutable` so it can only be called once. The Token must have been deployed with `minter = this airdrop contract`.

### `claim(...)` — Private

Verifies a zkTLS attestation and mints private tokens via `Token.mint_to_private`. Parameters:
- Attestation: `public_key_x`, `public_key_y`, `hash`, `signature`
- URLs: `request_urls`, `allowed_urls`
- Content: `data_hashes`, `contents`
- Identity: `github_username`, `github_id`

### Token Contract Functions

The Token contract (from [aztec-standards](https://github.com/defi-wonderland/aztec-standards)) provides:
- `balance_of_private(owner)` — query private balance (utility)
- `balance_of_public(owner)` — query public balance (view)
- `transfer_private_to_private(from, to, amount, nonce)` — transfer tokens privately
- `total_supply()` — total minted tokens

## Running Tests

```bash
# Ensure Aztec local network is running
aztec start --local-network

# Run tests (claim tests require a valid attestation at testdata/attestation.json)
yarn test
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `aztec-nr` (v4.2.0-aztecnr-rc.2) | Aztec contract framework |
| `token_contract` (aztec-standards) | ERC20-like token with private minting |
| `att_verifier_lib` | Primus zkTLS Noir verification library |
| `poseidon` (v0.2.6) | Poseidon2 hashing for claim nullifiers |
| `@aztec/aztec.js` | Aztec SDK for deployment and interaction |
| `@aztec/bb.js` | Barretenberg backend for Poseidon2 hashing |
| `@noble/curves` | ECDSA secp256k1 public key recovery |
| `@noble/hashes` | Keccak256 for attestation message hashing |

## Troubleshooting

### "Cannot find module './contract/artifacts/...'"
Run `yarn ccc` to compile the contract and generate TypeScript bindings.

### "caller is not minter"
The Token contract's minter must be set to the airdrop contract's address. Ensure the deployment order is correct: airdrop first, then token with `minter = airdrop.address`.

### "only deployer can set token"
Only the address passed as `deployer` in the airdrop constructor can call `set_token`.

### Duplicate nullifier (double claim rejected)
Each GitHub ID can only claim once. The Poseidon2 hash of the ID is emitted as a nullifier — the protocol rejects duplicates automatically.

## Resources

- [Primus zkTLS Tutorial](https://hashcloak.com/blog/primus-noir-zktls-tutorial)
- [Primus zkTLS Noir Verification](https://github.com/primus-labs/zktls-verification-noir)
- [Aztec Token Standard](https://github.com/defi-wonderland/aztec-standards)
- [Primus Developer Hub](https://dev.primuslabs.xyz)
- [Aztec Documentation](https://docs.aztec.network/)
