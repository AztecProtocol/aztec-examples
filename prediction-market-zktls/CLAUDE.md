# CLAUDE.md

## Project Overview

Private prediction market on Aztec with zkTLS resolution and real token collateral. Binary outcome markets ("Will BTC be above $X by date Y?") using a **complete-set model** for provable solvency.

## Architecture

Uses a complete-set model instead of an AMM:
- `mint_sets(n)`: deposit n collateral tokens, receive n YES + n NO shares
- `burn_sets(n)`: return n YES + n NO shares, receive n collateral tokens
- `redeem(n)`: after resolution, burn n winning shares, receive n collateral
- Solvency invariant: total_collateral = total_yes = total_no (always)

### Files
- **src/main.nr**: `PredictionMarketZkTLS` contract -- complete sets, token integration, zkTLS resolution, private redemption
- **src/config.nr**: Constants (NUM_ALLOWED_URLS)
- **src/price.nr**: ASCII decimal price parser (e.g., "97234.56" -> 9723456 cents)
- **scripts/**: TypeScript for attestation parsing, URL hashing, deployment
- **tests/**: Integration tests using vitest

## Key Design Decisions

- **Complete-set model** instead of AMM -- provably solvent, no insolvency risk
- **Real token collateral** via defi-wonderland/aztec-standards Token contract
- `mint_sets` uses `transfer_private_to_public` (user -> contract public balance) with auth witness
- `burn_sets`/`redeem` use `transfer_public_to_private` (contract -> user private balance)
- `resolve_market` is **private** (ECDSA verification in circuit), enqueues public `_set_resolution`
- **Trusted attester pinning**: Poseidon2 hash of attester's public key stored at deployment; `resolve_market` rejects attestations from unknown signers
- **MPC TLS mode** (`mpctls`): client and attester collaboratively compute attestation (neither sees full TLS key material)
- **Resolution window** (7 days) limits stale attestation attacks
- Double-resolution prevention via `PublicImmutable::initialize`

## Token Integration

Collateral flow:
- Deposit: `Token.transfer_private_to_public(user, market, amount, nonce)` -- requires auth witness
- Withdrawal: `Token.transfer_public_to_private(market, user, amount, 0)` -- no auth witness (market is `from`)

Deployment order:
1. Parse attestation file to extract attester public key, compute Poseidon2 key hash
2. Deploy PredictionMarketZkTLS (pass `attester_key_hash` to constructor)
3. Deploy Token (with `constructor_with_minter`, admin as minter)
4. Call `market.set_token(token.address)`
5. Mint tokens to users via `token.mint_to_private(recipient, amount)`

## Development Commands

```bash
yarn install          # Install dependencies
yarn ccc              # Compile contract + generate TypeScript bindings
yarn test:noir        # Run Noir unit tests (price parser)
yarn generate         # Generate zkTLS price attestation
yarn demo             # Full lifecycle demo
yarn test             # Run integration tests
```

## Contract Constants

Must stay in sync between contract and TypeScript:
- `MAX_URL_LEN = 128`
- `MAX_PLAINTEXT_LEN = 50`
- `NUM_RESPONSE_RESOLVE = 2`
- `NUM_ALLOWED_URLS = 3`
- `RESOLUTION_WINDOW = 604800` (7 days in seconds)

## Dependencies

- Aztec: `v4.2.0-aztecnr-rc.2`
- Token: `defi-wonderland/aztec-standards` at `v4.2.0-aztecnr-rc.2`
- `att_verifier_lib`: from `primus-labs/zktls-verification-noir` (main)
- `poseidon` v0.2.6
