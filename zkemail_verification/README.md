# ZK Email Offchain Transfers for Aztec

A complete example of offchain-authorized token transfers using DKIM-signed emails. Bob deposits tokens into a contract, then authorizes payments by sending a plain email. Carol creates a partial note, gets Bob's email authorization, generates a zkEmail proof, and submits it to claim her tokens. Bob never touches the network after the initial deposit.

Built with [zkemail.nr](https://github.com/zkemail/zkemail.nr) and the [Offchain-Authorized Transfers](https://docs.aztec.network/tutorials/contract_tutorials/offchain_transfer) tutorial pattern on Aztec 4.2.0.

## Overview

This project combines **partial notes** with **zkEmail proof verification** to enable email-authorized token payments entirely on L2:

1. **Bob deposits** tokens into the `EmailClaim` contract, mapped to his email address hash
2. **Carol creates a partial note** (a private commitment to receive tokens)
3. **Bob sends an email** with the intended action in the subject line
4. **Carol generates a zkEmail proof** offchain using a Noir circuit
5. **Carol submits the proof** to complete her partial note and receive the tokens

Bob's only onchain action is the initial deposit. Everything after that is an email from any standard mail client.

## Security Model

The contract enforces a 6-point security model on each email claim:

1. **DKIM key binding** -- The proof's DKIM public key hash must match the trusted key stored at deployment. Prevents self-signed forgeries.
2. **Sender identification** -- The `From` address hash identifies the depositor, used to look up whose balance to deduct.
3. **Recipient binding** -- The email's `To` address hash must match the expected recipient. Prevents using an email sent to someone else.
4. **Intent binding** -- The email's `Subject` hash must match the expected action. Prevents reusing an email for a different purpose.
5. **Single use** -- Each email produces a unique nullifier pushed to Aztec's nullifier tree. The protocol rejects duplicate claims.
6. **Freshness** -- The DKIM signing timestamp must be within `max_email_age` seconds of the block timestamp.

### DKIM Key Rotation Caveat

This example pins the trusted DKIM public key hash at contract deployment time. In practice, mail providers rotate their DKIM signing keys periodically. When that happens, proofs using the new key will be rejected by the contract.

A production system should replace the static key hash with a **DKIM key registry** that tracks current keys per `(domain, selector)` pair. The two main approaches:

1. **DNSSEC-aware proof** -- The prover includes the full DNSSEC chain from the DNS root to the DKIM TXT record. Strongest trust model but requires in-circuit DNSSEC signature verification.

2. **Narrowly-scoped DNSSEC oracle** -- An off-chain service resolves the DKIM TXT record with full DNSSEC validation and submits signed attestations to an on-chain registry. Simpler to implement.

In either case, the contract should check key expiry and support updates without redeployment.

### Deterministic Partial Notes

The contract's `create_claim(randomness)` accepts caller-provided randomness so Carol can compute the partial note commitment offchain as `poseidon2([carolAddress, randomness], DomainSeparator.NOTE_HASH)` before the transaction lands. This lets Carol include the commitment in the email she asks Bob to send, without waiting for `create_claim` to finalize. The standard `UintNote::partial()` at v4.2.0 samples randomness from the oracle, which doesn't support this UX -- so the contract reimplements the partial note creation logic with explicit randomness. Carol is responsible for generating cryptographically-strong randomness; a predictable value enables brute-force recovery of her address from the public commitment.

### Privacy Tradeoffs

**What stays private:**
- **The email is never revealed onchain.** The zkEmail proof attests to properties of the email (sender, recipient, subject, timestamp) without exposing the raw headers or body. Observers see only hashes and the proof.
- **Carol's identity is hidden.** The partial note commitment hides her address. Observers cannot determine who received the tokens.

**What is public:**
- **Bob's deposit and balance.** The `deposit()` call and the `deposits` map are public state. Observers can see how much Bob deposited, his email address hash, and when funds are deducted.
- **Bob's email address hash is linkable.** The `from_address_hash` is stored in public state and passed through `_complete`. Anyone who knows (or guesses) Bob's email address can compute the hash and confirm he is the depositor.
- **The claim amount is visible.** The partial note is completed in `_complete` (a public function), so the transfer amount is onchain.
- **Deposit-to-claim linkage.** An observer can see that a specific deposit balance was deducted in the same transaction that completed a partial note, linking the funding source to the claim event -- even though Carol's identity remains hidden.

## Architecture

```
                                  +----------------------------+
Raw Email --> [Noir Circuit] -->  |  7 public outputs:         |
                  |               |  [0] pubkey_hash[0]        |
                  |  DKIM verify  |  [1] pubkey_hash[1]        |
                  |  from domain  |  [2] email_nullifier       |--> [EmailClaim Contract]
                  |  from addr    |  [3] from_address_hash     |        |
                  |  to addr      |  [4] to_address_hash       |        |  verify_honk_proof()
                  |  subject      |  [5] intent_hash           |        |  check DKIM key
                  |  timestamp    |  [6] dkim_timestamp        |        |  identify depositor
                  |               +----------------------------+        |  check recipient
                  |                                                     |  check intent
                  |  Body verification omitted --                       |  push nullifier
                  |  all auth data is in DKIM-signed headers            |  check freshness
                  |                                                     |  deduct balance
                  |                                                     |  complete partial note
```

### Circuit (`circuit/src/main.nr`)

Standalone Noir binary using [zkemail.nr](https://github.com/zkemail/zkemail.nr):
- Verifies 2048-bit RSA DKIM signature over the email header
- Extracts sender domain (`icloud.com`) and full sender address hash
- Extracts recipient address hash, subject hash, and DKIM timestamp
- Outputs Poseidon2 hash of the DKIM signature as an email nullifier

### Contract (`contract/src/main.nr`)

Aztec contract following the `EmailClaim` pattern from the [offchain transfer tutorial](https://docs.aztec.network/tutorials/contract_tutorials/offchain_transfer):

- `constructor(token, vk_hash, trusted_dkim_key_hash_0, trusted_dkim_key_hash_1, max_email_age)` -- Binds to a token, sets trusted DKIM key and email age limit
- `deposit(email_address_hash, amount, authwit_nonce)` -- Bob deposits tokens mapped to his email address hash
- `create_claim()` -- Carol creates a partial note (private commitment)
- `claim_with_email(expected_recipient_hash, expected_intent_hash, partial_note, amount, vk, proof, public_inputs)` -- Verifies the email proof, enforces the 6-point security model, then enqueues public completion
- `_complete(...)` -- Public function that checks freshness, deducts from depositor balance, and completes the partial note

## Prerequisites

- [Node.js](https://nodejs.org/) (v22+) and [Yarn](https://yarnpkg.com/)
- [Aztec CLI](https://docs.aztec.network/getting_started/quickstart) (version 4.2.0-aztecnr-rc.2)

```bash
# Install Aztec CLI
bash -i <(curl -s https://install.aztec.network)
aztec-up 4.2.0-aztecnr-rc.2
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

# Deploy token + email claim contract, deposit, create claim, verify proof
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
| `yarn data` | Generate UltraHonk proof from test email data, write `data.json` |
| `yarn verify` | Full flow on local network: deploy, deposit, claim, verify |
| `yarn testnet` | Full flow on Aztec testnet |
| `yarn test` | Run Vitest integration tests against local network |

## Circuit Public Outputs (7 fields)

| Index | Output | Description |
|-------|--------|-------------|
| `[0]` | `pubkey_hash[0]` | Poseidon hash of DKIM RSA modulus (root of trust) |
| `[1]` | `pubkey_hash[1]` | Poseidon hash of DKIM RSA redc parameter |
| `[2]` | `email_nullifier` | Poseidon2 hash of DKIM signature (prevents replay) |
| `[3]` | `from_address_hash` | Poseidon2 hash of sender email (depositor identification) |
| `[4]` | `to_address_hash` | Poseidon2 hash of recipient email (recipient binding) |
| `[5]` | `intent_hash` | Poseidon2 hash of subject content (intent binding) |
| `[6]` | `dkim_timestamp` | DKIM signing timestamp in seconds (freshness) |

## Dependencies

- [zkemail.nr](https://github.com/critesjosh/zkemail.nr/tree/update/aztec-4.2.0-compat) -- Noir DKIM email verification
- [poseidon](https://github.com/noir-lang/poseidon) v0.2.0 -- Poseidon2 hashing for Noir
- [aztec-nr](https://github.com/AztecProtocol/aztec-packages/) v4.2.0-aztecnr-rc.2 -- Aztec smart contract framework
- [bb_proof_verification](https://github.com/AztecProtocol/aztec-packages/) -- Barretenberg proof verification
- [@aztec/bb.js](https://www.npmjs.com/package/@aztec/bb.js) 4.2.0-aztecnr-rc.2 -- UltraHonk proving backend
