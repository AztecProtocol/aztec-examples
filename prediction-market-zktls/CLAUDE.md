# CLAUDE.md

## Project Overview

Private prediction market on Aztec with zkTLS resolution. Binary outcome markets ("Will BTC be above $X by date Y?") where bets are fully private, resolution uses Primus zkTLS attestations from CoinGecko's price API, and settlement is private.

## Architecture

- **src/main.nr**: `PredictionMarketZkTLS` contract — CSMM pricing, partial notes for private betting, zkTLS resolution, private redemption
- **src/lib.nr**: Constant Sum Market Maker pricing functions
- **src/config.nr**: `MarketConfig` and `Resolution` structs for PublicImmutable storage
- **src/price.nr**: ASCII decimal price parser (e.g., "97234.56" → 9723456 cents)
- **scripts/**: TypeScript for attestation parsing, URL hashing, deployment, attestation generation
- **tests/**: Integration tests using vitest

## Key Design Decisions

- `resolve_market` is **public** (not private) — outcome is inherently public, avoids expensive zkTLS verification in circuit
- Double-resolution prevention via `PublicImmutable::initialize` (fails on second call)
- Both response resolves extract the same CoinGecko price to satisfy att_verifier_lib's NUM_RESPONSE_RESOLVE=2
- `redeem` is **private** — burns winning shares and credits collateral via private notes

## Development Commands

```bash
yarn install          # Install dependencies
yarn ccc              # Compile contract + generate TypeScript bindings
yarn url-hashes       # Compute Poseidon2 hashes for CoinGecko URLs
yarn generate         # Generate zkTLS price attestation (needs PRIMUS_APP_ID/SECRET in .env)
yarn demo             # Full lifecycle: deploy, bet, resolve, redeem
yarn test             # Run integration tests
yarn test:noir        # Run Noir unit tests (pricing + price parser)
```

## Key Dependencies

- Aztec: `v4.2.0-aztecnr-rc.2`
- `att_verifier_lib`: from `primus-labs/zktls-verification-noir` (main)
- `poseidon` v0.2.6: Poseidon2 for URL hashing
- `balance_set` + `uint_note`: Private balance management

## Contract Constants

Must stay in sync between contract and TypeScript:
- `MAX_URL_LEN = 128`
- `MAX_PLAINTEXT_LEN = 50`
- `NUM_RESPONSE_RESOLVE = 2` (price + price_confirm)
- `NUM_ALLOWED_URLS = 3` (fixed by att_verifier_lib)

## Market Lifecycle

1. Deploy with config (admin, liquidity, expiry, threshold, URL hashes)
2. Users deposit collateral and buy YES/NO shares (all private)
3. After expiry, anyone resolves with a CoinGecko zkTLS attestation
4. Winners redeem shares for collateral 1:1 (private)
