# CLAUDE.md

## Project Overview

Fully-private token airdrop on Aztec for primus-labs GitHub contributors. Uses Primus zkTLS attestations for contributor verification and the defi-wonderland/aztec-standards Token contract for private minting. No public state is mutated during claims.

## Architecture

- **contract/**: `PrimusAirdrop` contract
  - `att_verifier_lib` for zkTLS attestation verification (ECDSA + SHA256 + URL matching)
  - `token_contract` from defi-wonderland/aztec-standards for private token minting
  - `PublicImmutable` for all config (deployer, token address, URL hashes, airdrop amount)
  - Nullifier-based double-claim prevention (Poseidon2 hash of GitHub ID)
  - Cross-contract `Token::at(token).mint_to_private(claimer, amount)` in private `claim` function
- **scripts/**: TypeScript for attestation parsing, URL hashing, 3-step deployment
- **tests/**: Integration tests using vitest

## Deployment Order

1. Deploy PrimusAirdrop with `constructor(deployer, url_hashes, amount)`
2. Deploy Token with `constructor_with_minter(name, symbol, decimals, minter=airdrop.address)`
3. Call `airdrop.set_token(token.address)` — one-time PublicImmutable initialization

## Development Commands

```bash
yarn install          # Install dependencies
yarn ccc              # Compile contract + generate TypeScript bindings
yarn url-hashes       # Compute Poseidon2 hashes for allowed URLs
yarn generate <repo> <user>  # Generate zkTLS attestation (needs PRIMUS_APP_ID/SECRET)
yarn claim            # Deploy contracts and submit claim
yarn test             # Run integration tests
```

## Key Dependencies

- Aztec: `v4.2.0-aztecnr-rc.2` (uses aztec-packages source, matching token_contract)
- `token_contract`: from `defi-wonderland/aztec-standards` (dev branch)
- `att_verifier_lib`: from `primus-labs/zktls-verification-noir`
- `poseidon` v0.2.6: Poseidon2 for claim nullifiers

## Contract Constants

Must stay in sync between contract and TypeScript:
- `MAX_URL_LEN = 128`
- `MAX_PLAINTEXT_LEN = 50`
- `NUM_RESPONSE_RESOLVE = 2` (username + contributor-id)
- `NUM_ALLOWED_URLS = 3` (fixed by att_verifier_lib)
