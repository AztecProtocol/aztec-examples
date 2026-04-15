# Verify ZK Email Proofs in Aztec Contracts

Proves that an email was sent from a specific domain (`icloud.com`) using DKIM signature verification in a Noir circuit, then verifies that proof on-chain inside an Aztec private smart contract.

Built to validate the [zkemail.nr](https://github.com/zkemail/zkemail.nr) library's compatibility with Aztec 4.2.0.

## Overview

This project implements:

- **Noir Circuit** (`circuit/`): Verifies a 2048-bit RSA DKIM signature, checks the body hash, extracts the sender address, and asserts the sender domain is `icloud.com`. Returns three public outputs: two public key hashes (root of trust) and an email nullifier.
- **Aztec Contract** (`contract/`): A private smart contract that verifies the Noir proof on-chain using `verify_honk_proof` and tracks a per-user verification count.
- **Proof Generation** (`scripts/generate_data.ts`): Generates an UltraHonk proof from hardcoded test email data and verifies it off-chain before writing `data.json`.
- **On-chain Verification** (`scripts/run_testnet.ts`): Deploys the contract and submits the proof for verification on the Aztec testnet.

**Aztec Version**: `4.2.0-aztecnr-rc.2` (compatible with testnet `4.2.0-rc.1`)

## Testnet Deployment

Successfully deployed and verified on the Aztec testnet (`https://rpc.testnet.aztec-labs.com`) with real proofs enabled.

| Step | Transaction Hash |
|------|-----------------|
| Account deployment | `0x190a55042b4a4bd063150c0b1d2a233c07e8b4b7decb3ba57e2527c646acd2be` |
| Contract deployment | `0x258f5c271e67ce681cf7db8641984d78d6e7718268d6cb4b9897d8ac624709bc` |
| Email proof verification | `0x2c053bad6f58bfcdea0b2bc4b918e0e31bb3d38aed740ac836e227cd5b7bca4e` |

**Contract address**: `0x1bbf99d2acd54c9dc9ef58fd05892fec9d5916fa66949aead6877964879a142b`

## How It Works

```
Raw Email ──> [Noir Circuit] ──> UltraHonk Proof ──> [Aztec Contract] ──> On-chain Verification
                  │                                        │
                  │  DKIM verify                           │  verify_honk_proof()
                  │  Body hash check                       │  Increment counter
                  │  Domain = icloud.com                   │
                  │                                        │
                  └──> 3 public outputs:                   └──> VK hash stored in
                       pubkey_hash[0]                           PublicImmutable storage
                       pubkey_hash[1]
                       email_nullifier
```

1. The **inner circuit** (`circuit/src/main.nr`) uses the [zkemail.nr](https://github.com/zkemail/zkemail.nr) library to:
   - Verify the DKIM RSA signature over the email header
   - Extract and verify the body hash from the DKIM-Signature header against a SHA256 hash of the body
   - Extract the sender email address from the `From:` header
   - Assert the sender domain is `icloud.com`
   - Output the public key hash (Poseidon), redc parameter hash, and email nullifier (Pedersen)

2. An **UltraHonk proof** is generated off-chain using Barretenberg (`@aztec/bb.js`), then verified off-chain to confirm validity.

3. The **Aztec contract** (`contract/src/main.nr`) calls `verify_honk_proof(vk, proof, public_inputs, vk_hash)` inside a private function. The VK hash is stored at deployment to bind the contract to the specific circuit. On successful verification, a public counter is incremented.

4. With `proverEnabled: true`, the PXE generates real ClientIVC proofs that enforce the `verify_honk_proof` constraint during private kernel execution — the inner proof is cryptographically verified, not skipped.

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
│   ├── src/main.nr                # DKIM verify + domain check + public outputs
│   └── Nargo.toml                 # Depends on zkemail.nr and sha256
├── contract/                       # Aztec smart contract
│   ├── src/main.nr                # verify_honk_proof + counter storage
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

### Deploy to Testnet

```bash
yarn testnet
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

## Scripts

| Command | Description |
|---------|-------------|
| `yarn ccc` | Compile Aztec contract + generate TypeScript bindings |
| `yarn data` | Generate UltraHonk proof from test email data, verify off-chain, write `data.json` |
| `yarn testnet` | Deploy contract and verify proof on the Aztec testnet |
| `yarn verify` | Deploy contract and verify proof on local network |
| `yarn test` | Run Vitest integration tests against local network |

## Circuit Details

The inner circuit verifies a DKIM-signed email from `icloud.com` using ~222K constraints:

| Component | Constraints | Description |
|-----------|------------|-------------|
| DKIM signature verification | ~86,500 | RSA-2048 PKCS#1 v1.5 over SHA256 header hash |
| Body hash (SHA256) | ~114,000 | SHA256 over email body, compared to DKIM `bh=` field |
| Address extraction | ~16,000 | Extract and validate `From:` email address |
| Domain check | ~100 | Assert domain bytes match `icloud.com` |
| Key + nullifier hashing | ~10,200 | Poseidon hash of pubkey, Pedersen hash of signature |

**Public outputs** (3 fields):
- `pubkey_hash[0]` — Poseidon hash of RSA modulus (root of trust)
- `pubkey_hash[1]` — Poseidon hash of RSA redc parameter
- `email_nullifier` — Pedersen hash of DKIM signature (prevents double-use)

## Contract Details

The `ZKEmailVerifier` contract stores a verification key hash at deployment and exposes:

- `verify_email(owner, vk, proof, public_inputs)` — **private function** that verifies the UltraHonk proof and enqueues a public state update
- `get_verification_count(owner)` — **public view** that returns how many emails have been verified for an address

The contract uses the hybrid private/public execution pattern: proof verification happens privately (the email content is never revealed on-chain), while the verification count is updated publicly.

## Troubleshooting

**"Cannot find module '../contract/artifacts/ZKEmailVerifier'"**
Run `yarn ccc` to compile the contract and generate TypeScript bindings.

**"Cannot find module '../data.json'"**
Run `yarn data` to generate the proof data.

**"Failed to connect" on testnet**
Check testnet status: `curl https://rpc.testnet.aztec-labs.com/status`

**Proof verification fails off-chain**
Ensure the circuit was compiled with `nargo compile` after any changes, then re-run `yarn data`.

## Dependencies

- [zkemail.nr](https://github.com/zkemail/zkemail.nr) — Noir library for DKIM email verification
- [aztec-nr](https://github.com/AztecProtocol/aztec-nr/) v4.2.0-aztecnr-rc.2 — Aztec smart contract framework
- [bb_proof_verification](https://github.com/AztecProtocol/aztec-packages/) — Barretenberg proof verification for Aztec contracts
- [@aztec/bb.js](https://www.npmjs.com/package/@aztec/bb.js) 4.2.0-aztecnr-rc.2 — UltraHonk proving backend
