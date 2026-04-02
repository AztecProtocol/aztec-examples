# Private Prediction Market with zkTLS Resolution

A private prediction market on Aztec with real token collateral, provable solvency via complete sets, and trustless resolution via zkTLS.

## What This Does

- **Private positions**: No one sees who holds YES or NO shares
- **Real collateral**: Backed by actual Aztec token transfers (not phantom balances)
- **Provably solvent**: Complete-set model guarantees total collateral >= total winning shares
- **Trustless resolution**: Primus zkTLS attestation from CoinGecko's price API
- **Private settlement**: Winners redeem shares for collateral tokens

## Complete-Set Model

Unlike AMM-based prediction markets that can become insolvent, this contract uses **complete sets**:

```
mint_sets(1000):  deposit 1000 collateral -> get 1000 YES + 1000 NO shares
burn_sets(1000):  return 1000 YES + 1000 NO -> get 1000 collateral back
redeem(1000):     after resolution, burn 1000 winning shares -> get 1000 collateral
```

**Solvency proof**: Every collateral token backs exactly 1 YES + 1 NO share. After resolution, only winning shares redeem. Since `winning_shares <= total_shares = total_collateral`, the contract is always solvent.

Users trade YES and NO shares peer-to-peer. The market price emerges from what traders are willing to pay for each side.

## How It Works

```
1. DEPLOY
   Admin creates market: "BTC above $50k by July 1?"
   Sets: threshold, expiry, CoinGecko URL hash, collateral token,
         trusted attester key hash (Poseidon2 of Primus public key)

2. MINT SETS (private)
   Users deposit collateral tokens -> receive equal YES + NO shares
   Auth witness authorizes the token transfer

3. TRADE (off-chain / peer-to-peer)
   Users trade YES/NO shares to express their view
   Can also burn_sets() to exit entirely (return YES+NO for collateral)

4. RESOLUTION (after expiry, within 7-day window)
   Anyone submits CoinGecko zkTLS attestation (MPC-TLS mode)
   Private: ECDSA verification + attester identity check + price parsing
   Public: expiry check + resolution window + state update

5. SETTLEMENT (private)
   Winners: redeem(amount) -> burn shares, receive collateral tokens
   Losers: shares are worthless (or burn complete sets if holding both)
```

## Quick Start

```bash
# Install Aztec tools
bash -i <(curl -s https://install.aztec.network)
aztec-up 4.2.0-aztecnr-rc.2

# Install dependencies
yarn install

# Compile contract + generate TypeScript bindings
yarn ccc

# Run Noir unit tests
yarn test:noir

# Generate price attestation (needs PRIMUS credentials in .env)
yarn generate

# Start Aztec local network (separate terminal)
aztec start --local-network

# Run full lifecycle demo
yarn demo

# Run integration tests
yarn test
```

## Architecture

### Contract (`src/main.nr`)

**Storage:**
- `yes_balances`, `no_balances` -- private share notes (Owned<BalanceSet>)
- `token` -- collateral token address (PublicImmutable)
- `total_sets` -- total complete sets outstanding (PublicMutable)
- `trusted_attester_hash` -- Poseidon2 hash of trusted Primus attester public key (PublicImmutable)
- `expiry`, `price_threshold`, `threshold_above`, `allowed_url_hashes` -- market config (PublicImmutable)
- `resolution_outcome`, `resolution_price` -- result (PublicImmutable, initialized once)

**Key Functions:**
| Function | Context | Purpose |
|----------|---------|---------|
| `mint_sets(amount, nonce)` | private | Deposit collateral, get YES+NO shares |
| `burn_sets(amount)` | private | Return YES+NO shares, get collateral back |
| `redeem(amount)` | private | After resolution, burn winning shares for collateral |
| `resolve_market(...)` | private->public | Verify zkTLS attestation, set outcome |
| `set_token(addr)` | public | One-time token link (admin only) |

### Token Integration

Uses [defi-wonderland/aztec-standards](https://github.com/defi-wonderland/aztec-standards) Token contract at `v4.2.0-aztecnr-rc.2`.

- **Deposit**: `Token.transfer_private_to_public(user, market, amount, nonce)` with auth witness
- **Withdrawal**: `Token.transfer_public_to_private(market, user, amount, 0)` -- no auth needed

### zkTLS Resolution

Uses [Primus zkTLS](https://primuslabs.xyz) in **MPC-TLS mode** (`mpctls`): the client and Primus attester collaboratively compute the TLS session key material via multi-party computation. Neither party holds the full key alone, so neither can unilaterally forge TLS data.

After market expiry (within 7-day resolution window):
1. Anyone fetches BTC price from CoinGecko via Primus zkTLS (MPC-TLS mode)
2. `resolve_market` (private) verifies ECDSA signature, checks attester identity against pinned key hash, parses price
3. `_set_resolution` (public) checks expiry window and sets outcome (`PublicImmutable::initialize` prevents double-resolution)

**Trust assumptions:**
- **Primus attester identity** is pinned at deployment (Poseidon2 hash of the attester's secp256k1 public key stored in contract). Attestations from unknown signers are rejected.
- **MPC-TLS** prevents either party (client or attester) from forging TLS data unilaterally. In contrast, proxy-TLS mode trusts the attester to actually communicate with the intended server.
- **CoinGecko** is trusted as the price data source. The contract whitelists allowed API URLs via Poseidon2 hashes.
- **Resolution window** (7 days) limits the use of stale attestations.

## Project Structure

```
prediction-market-zktls/
|-- src/
|   |-- main.nr          # Contract: complete sets, token integration, resolution
|   |-- config.nr         # Constants
|   +-- price.nr          # ASCII price parser + unit tests
|-- scripts/
|   |-- parse_attestation.ts     # Attestation -> contract args
|   |-- compute_url_hashes.ts    # Poseidon2 URL + attester key hashing
|   |-- generate_attestation.ts  # CoinGecko attestation generator
|   |-- deploy_and_resolve.ts    # Full lifecycle demo
|   +-- sponsored_fpc.ts         # Fee payment helper
|-- tests/
|   +-- prediction_market_zktls.test.ts
|-- testdata/
|   +-- sample-attestation.json
|-- Nargo.toml
+-- package.json
```
