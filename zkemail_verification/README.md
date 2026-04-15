# ZK Email Auth for Aztec

Proves email-based authorization using DKIM signature verification in a Noir circuit, then verifies that proof on-chain inside an Aztec private smart contract. Each email proof binds to a specific recipient, encodes an intent via the subject field, is single-use (nullifier), and must be fresh (timestamp check).

Built with the [zkemail.nr](https://github.com/zkemail/zkemail.nr) library on Aztec 4.2.0.

## Security Model

The contract enforces five constraints on each email proof:

1. **DKIM key binding** — The proof's DKIM public key hash (`public_inputs[0]`, `[1]`) must match the trusted key hashes stored at deployment. Without this, an attacker could generate their own RSA keypair, forge a DKIM signature, and produce a valid proof.
2. **Recipient binding** — The email's `to` address must hash to the `authorized_email_hash` stored at deployment. Only emails sent to the account owner's address are accepted.
3. **Intent binding** — The email's `subject` field is hashed and compared against a caller-provided `expected_intent_hash`. This ties the email to a specific action (e.g., a Poseidon hash of calldata placed in the subject).
4. **Single use** — The DKIM signature is hashed into a nullifier and pushed on-chain. Replaying the same email proof fails because the nullifier already exists.
5. **Freshness** — The DKIM `t=` timestamp is extracted and checked in a public function against the block timestamp. Emails older than `max_email_age` seconds are rejected.

The sender's domain is also verified to be `icloud.com` via DKIM in the circuit.

### DKIM Key Rotation Caveat

This example pins the trusted DKIM public key hash at contract deployment time. In practice, mail providers rotate their DKIM signing keys periodically — a domain can publish a new key under the same selector, or switch selectors entirely. When that happens, proofs generated with the old key will still verify, but proofs using the new key will be rejected by the contract (the key hash won't match).

A production system should replace the static key hash with a **DKIM key registry** that tracks current keys per `(domain, selector)` pair. The two main approaches:

1. **DNSSEC-aware proof** — The prover includes the full DNSSEC chain from the DNS root to the DKIM TXT record. The circuit or a dedicated verifier contract validates the chain, proving the key was authentically published in DNS. This is the strongest trust model but requires in-circuit DNSSEC signature verification (multiple RSA/ECDSA checks across the delegation chain) and handling of signature validity windows.

2. **Narrowly-scoped DNSSEC oracle** — An off-chain service resolves the DKIM TXT record with full DNSSEC validation and submits signed `(domain, selector, key_hash, expires_at)` attestations to an on-chain registry. The email verifier contract checks the proof's key against the registry. This is simpler to implement and sufficient when the oracle's trust boundary is acceptable.

In either case, the contract should check key expiry and support updates without redeployment.

## How It Works

```
                                  ┌──────────────────────────┐
Raw Email ──> [Noir Circuit] ──>  │  6 public outputs:       │
                  │               │  [0] pubkey_hash[0]      │
                  │  DKIM verify  │  [1] pubkey_hash[1]      │
                  │  from domain  │  [2] email_nullifier     │──> [Aztec Contract]
                  │  to address   │  [3] to_address_hash     │        │
                  │  subject      │  [4] intent_hash         │        │  verify_honk_proof()
                  │  timestamp    │  [5] dkim_timestamp      │        │  check DKIM key
                  │               └──────────────────────────┘        │  check recipient
                  │                                                   │  check intent
                  │  Body verification omitted —                      │  push nullifier
                  │  all auth data is in DKIM-signed headers,         │  check freshness
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

- `constructor(vk_hash, trusted_dkim_key_hash_0, trusted_dkim_key_hash_1, authorized_email_hash, max_email_age)` — Stores the verification key hash, the trusted DKIM public key hashes (modulus and redc), the Poseidon2 hash of the authorized recipient email, and the maximum email age in seconds.
- `verify_email(expected_intent_hash, vk, proof, public_inputs)` — **Private function** that:
  1. Verifies the UltraHonk proof against the stored VK hash
  2. Asserts `public_inputs[0]` and `[1]` (DKIM key hashes) match the trusted key
  3. Asserts `public_inputs[3]` (to address hash) matches `authorized_email_hash`
  4. Asserts `public_inputs[4]` (subject hash) matches `expected_intent_hash`
  5. Pushes `public_inputs[2]` (email nullifier) to prevent replay
  6. Enqueues a public call to check `public_inputs[5]` (timestamp) is fresh
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
│   ├── src/main.nr                # verify_honk_proof + DKIM key + nullifier + timestamp
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

**"DKIM public key does not match trusted key"**
The proof was generated with a DKIM key that doesn't match the trusted key hashes stored at deployment. This can happen after a DKIM key rotation. To resolve, look up the current DKIM public key from DNS (e.g., `dig TXT <selector>._domainkey.icloud.com`), compute its Poseidon hash, and redeploy the contract with the updated key hashes. Do not take key hashes from the rejected proof's own public inputs — those are prover-controlled and may not reflect a legitimate key.

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
