# ZK Email Auth for Aztec

Proves email-based authorization using DKIM signature verification in a Noir circuit, then verifies that proof on-chain inside an Aztec private smart contract. Each email proof binds to a specific recipient, encodes an intent via the subject field, is single-use (nullifier), and must be fresh (timestamp check).

Built with the [zkemail.nr](https://github.com/zkemail/zkemail.nr) library on Aztec 4.2.0.

## Security Model

The contract enforces four constraints on each email proof:

1. **Recipient binding** — The email's `to` address must hash to the `authorized_email_hash` stored at deployment. Only emails sent to the account owner's address are accepted.
2. **Intent binding** — The email's `subject` field is hashed and compared against a caller-provided `expected_intent_hash`. This ties the email to a specific action (e.g., a Poseidon hash of calldata placed in the subject).
3. **Single use** — The DKIM signature is hashed into a nullifier and pushed on-chain. Replaying the same email proof fails because the nullifier already exists.
4. **Freshness** — The DKIM `t=` timestamp is extracted and checked in a public function against the block timestamp. Emails older than `max_email_age` seconds are rejected.

The sender's domain is also verified to be `icloud.com` via DKIM.

## How It Works

```
                                  ┌──────────────────────────┐
Raw Email ──> [Noir Circuit] ──>  │  6 public outputs:       │
                  │               │  [0] pubkey_hash[0]      │
                  │  DKIM verify  │  [1] pubkey_hash[1]      │
                  │  from domain  │  [2] email_nullifier     │──> [Aztec Contract]
                  │  to address   │  [3] to_address_hash     │        │
                  │  subject      │  [4] intent_hash         │        │  verify_honk_proof()
                  │  timestamp    │  [5] dkim_timestamp      │        │  check recipient
                  │               └──────────────────────────┘        │  check intent
                  │                                                   │  push nullifier
                  │  Body verification omitted —                      │  check freshness
                  │  all auth data is in DKIM-signed headers,         │
                  │  avoiding extra SHA256 hashing cost               │
```

### Circuit (`circuit/src/main.nr`)

Uses [zkemail.nr](https://github.com/zkemail/zkemail.nr) to:
- Verify the 2048-bit RSA DKIM signature over the email header
- Extract and verify the sender domain is `icloud.com`
- Extract the `to` address and output its Poseidon2 hash (identity binding)
- Extract the `subject` field and output its Poseidon2 hash (intent binding)
- Parse the `t=` tag from the DKIM-Signature header (timestamp for freshness)
- Output a Poseidon2 hash of the DKIM signature as an email nullifier (replay prevention)

Body verification is omitted since all authorization-relevant data lives in the DKIM-signed headers. This avoids the ~114K constraint SHA256 body hash computation.

### Contract (`contract/src/main.nr`)

- `constructor(vk_hash, authorized_email_hash, max_email_age)` — Stores the verification key hash, the Poseidon2 hash of the authorized recipient email, and the maximum email age in seconds.
- `verify_email(expected_intent_hash, vk, proof, public_inputs)` — **Private function** that:
  1. Verifies the UltraHonk proof against the stored VK hash
  2. Asserts `public_inputs[3]` (to address hash) matches `authorized_email_hash`
  3. Asserts `public_inputs[4]` (subject hash) matches `expected_intent_hash`
  4. Pushes `public_inputs[2]` (email nullifier) to prevent replay
  5. Enqueues a public call to check `public_inputs[5]` (timestamp) is fresh
- `_check_email_freshness(email_timestamp, max_age)` — **Public function** that checks `block.timestamp - email_timestamp <= max_age`
- `get_authorized_email_hash()` — **View function** that returns the stored authorized email hash
- `get_max_email_age()` — **View function** that returns the stored maximum email age

### Intent Encoding

The email subject serves as the intent field. For this example, the subject is hashed with Poseidon2 inside the circuit and output as `intent_hash`. To authorize an action:

1. Compute `intent_hash = Poseidon2(pack_31(subject_bytes) ++ [subject_length])` off-chain
2. Include the intent text as the email subject (e.g., a Poseidon hash of the calldata encoded as a string)
3. The circuit hashes the subject and outputs it
4. The contract verifies the proof's `intent_hash` matches the caller's `expected_intent_hash`

For a production system, the subject would contain a Poseidon hash of the calldata — easier to parse in-circuit than ASCII text and supports arbitrary call data encoding.

## Prerequisites

- [Node.js](https://nodejs.org/) (v22+) and [Yarn](https://yarnpkg.com/)
- [Aztec CLI](https://docs.aztec.network/getting_started/quickstart) (version 4.2.0-aztecnr-rc.2)

```bash
# Install Aztec CLI
bash -i <(curl -s https://install.aztec.network)
aztec-up 4.2.0-aztecnr-rc.2

# Verify nargo (bundled with Aztec CLI)
nargo --version  # 1.0.0-beta.18
```

## Project Structure

```
.
├── circuit/                        # Inner Noir circuit (vanilla bin, not Aztec contract)
│   ├── src/main.nr                # DKIM verify + address/subject/timestamp extraction
│   └── Nargo.toml                 # Depends on zkemail.nr
├── contract/                       # Aztec smart contract
│   ├── src/main.nr                # verify_honk_proof + nullifier + timestamp check
│   ├── artifacts/                 # Generated TypeScript bindings
│   └── Nargo.toml                 # Depends on aztec-nr and bb_proof_verification
├── scripts/
│   ├── generate_data.ts           # Build circuit inputs, generate + verify proof
│   ├── run_verification.ts        # Deploy + verify on local network
│   ├── run_testnet.ts             # Deploy + verify on Aztec testnet
│   └── sponsored_fpc.ts           # SponsoredFPC fee payment utility
├── tests/
│   └── zkemail_verification.test.ts  # Vitest integration tests
├── data.json                       # Generated proof data (created by yarn data)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Quick Start

```bash
# Install dependencies
yarn install

# Compile the inner Noir circuit
cd circuit && nargo compile && cd ..

# Compile the Aztec contract and generate TypeScript bindings
yarn ccc

# Generate proof data (generates + verifies proof, writes data.json)
yarn data
```

### Deploy to Local Network

```bash
# Start local network in a separate terminal
aztec start --local-network

# Deploy and verify
yarn verify

# Or run the full test suite
yarn test
```

### Deploy to Testnet

```bash
yarn testnet
```

## Scripts

| Command | Description |
|---------|-------------|
| `yarn ccc` | Compile Aztec contract + generate TypeScript bindings |
| `yarn data` | Generate UltraHonk proof from test email data, verify off-chain, write `data.json` |
| `yarn verify` | Deploy contract and verify proof on local network |
| `yarn testnet` | Deploy contract and verify proof on the Aztec testnet |
| `yarn test` | Run Vitest integration tests against local network |

## Circuit Details

The inner circuit verifies a DKIM-signed email from `icloud.com` and extracts auth data from the headers:

| Component | Description |
|-----------|-------------|
| DKIM signature verification | RSA-2048 PKCS#1 v1.5 over SHA256 header hash |
| From address extraction | Extract sender email and verify domain is `icloud.com` |
| To address hashing | Extract recipient email, Poseidon2 hash for identity binding |
| Subject hashing | Extract subject field, Poseidon2 hash for intent binding |
| Timestamp extraction | Parse `t=` tag from DKIM-Signature for freshness check |
| Nullifier computation | Poseidon2 hash of DKIM signature for replay prevention |

**Public outputs** (6 fields):
- `pubkey_hash[0]` — Poseidon hash of RSA modulus (root of trust)
- `pubkey_hash[1]` — Poseidon hash of RSA redc parameter
- `email_nullifier` — Poseidon2 hash of DKIM signature (prevents replay)
- `to_address_hash` — Poseidon2 hash of recipient email (identity binding)
- `intent_hash` — Poseidon2 hash of subject content (intent binding)
- `dkim_timestamp` — DKIM signing timestamp in seconds (freshness)

## Troubleshooting

**"Cannot find module '../contract/artifacts/ZKEmailVerifier'"**
Run `yarn ccc` to compile the contract and generate TypeScript bindings.

**"Cannot find module '../data.json'"**
Run `yarn data` to generate the proof data.

**"Email recipient does not match authorized address"**
The `to` address in the email doesn't match the `authorized_email_hash` stored at deployment. Ensure the proof was generated with the correct test email.

**"Email has expired"**
The DKIM timestamp is older than `max_email_age`. For testing with the hardcoded test email (April 2024), use a large `max_email_age` value.

**"Duplicate nullifier"**
The same email proof has already been used. Each email can only authorize one action.

## Dependencies

- [zkemail.nr](https://github.com/critesjosh/zkemail.nr/tree/update/aztec-4.2.0-compat) — Noir library for DKIM email verification (Aztec 4.2.0 branch)
- [poseidon](https://github.com/noir-lang/poseidon) v0.2.0 — Poseidon2 hash function for Noir
- [aztec-nr](https://github.com/AztecProtocol/aztec-nr/) v4.2.0-aztecnr-rc.2 — Aztec smart contract framework
- [bb_proof_verification](https://github.com/AztecProtocol/aztec-packages/) — Barretenberg proof verification for Aztec contracts
- [@aztec/bb.js](https://www.npmjs.com/package/@aztec/bb.js) 4.2.0-aztecnr-rc.2 — UltraHonk proving backend
