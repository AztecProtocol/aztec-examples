# Private Prediction Market with zkTLS Resolution

A private prediction market on Aztec with real token collateral, provable solvency via complete sets, and trustless resolution via zkTLS.

## What This Does

- **One-click trading**: Buy YES or Buy NO directly -- the AMM handles the other side
- **Private positions**: No one sees who holds YES or NO shares
- **Real collateral**: Backed by actual Aztec token transfers (not phantom balances)
- **Provably solvent**: Complete-set model guarantees total collateral >= total winning shares
- **Trustless resolution**: Primus zkTLS attestation from CoinGecko's price API
- **Private settlement**: Winners redeem shares for collateral tokens

## How It Works

```
1. CREATE MARKET
   Deploy market: "BTC above $50k by July 1?"
   Sets: threshold, expiry, CoinGecko URL, trusted attester key

2. SEED LIQUIDITY
   A liquidity provider deposits collateral to seed the AMM pool
   Pool starts at 50/50 (YES = $0.50, NO = $0.50)

3. BUY YES or BUY NO
   Users click "Buy YES" or "Buy NO" with collateral tokens
   The CPMM AMM prices shares and handles the other side:
     buy_yes: mint complete set -> pool absorbs NO -> user gets YES
     buy_no:  mint complete set -> pool absorbs YES -> user gets NO
   Prices move with each trade based on supply/demand

4. RESOLUTION (after expiry, within 7-day window)
   Anyone submits CoinGecko zkTLS attestation (MPC-TLS mode)
   ECDSA verification in private, state update in public

5. CLAIM PAYOUT
   Winners redeem shares 1:1 for collateral tokens
   Losers' shares are worthless
```

## Architecture: Complete Sets + CPMM AMM

The contract combines two models for solvency and usability:

**Complete-set model** (solvency layer):
```
mint_sets(1000):  deposit 1000 collateral -> get 1000 YES + 1000 NO shares
burn_sets(1000):  return 1000 YES + 1000 NO -> get 1000 collateral back
redeem(1000):     after resolution, burn 1000 winning shares -> get 1000 collateral
```

**CPMM AMM** (trading layer):
```
buy_yes(500):     spend 500 collateral -> receive ~950 YES shares (price-dependent)
buy_no(500):      spend 500 collateral -> receive ~950 NO shares (price-dependent)
add_liquidity(N): seed pool with N collateral (equal YES + NO reserves)
```

The AMM uses a Constant Product Market Maker (x * y = k) adapted for complete-set prediction markets. When you "Buy YES", the contract mints a complete set, keeps the NO shares in the pool, and gives you the YES shares. The amount you receive depends on pool reserves:

```
shares_out = C * (R_yes + R_no + C) / (R_opposite + C)
```

Prices naturally satisfy `price_YES + price_NO = 1`, and the 0.3% fee incentivizes liquidity providers.

**Solvency proof**: Every collateral token backs exactly 1 YES + 1 NO share. After resolution, only winning shares redeem. Since `winning_shares <= total_shares = total_collateral`, the contract is always solvent.

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
| `buy_yes(amount, min_out, nonce)` | private->public | Buy YES shares via AMM |
| `buy_no(amount, min_out, nonce)` | private->public | Buy NO shares via AMM |
| `add_liquidity(amount, nonce)` | private->public | Seed/add to AMM pool |
| `remove_liquidity(lp_amount)` | private->public | Withdraw from AMM pool |
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

**Generating attestations:**

Anyone can generate a price attestation to resolve the market. No account or setup required.

**Via the webapp** (recommended):
1. Go to the Resolve page for any expired market
2. Click **"Fetch BTC Price Attestation"**
3. The webapp fetches the current BTC/USD price from CoinGecko via Primus MPC-TLS directly in your browser
4. The attestation auto-fills -- click **"Submit Attestation to Resolve Market"**

The webapp ships with a default Primus App ID. You can optionally use your own (free at [dev.primuslabs.xyz](https://dev.primuslabs.xyz)).

**Via CLI:**
```bash
# Set credentials in .env
echo "PRIMUS_APP_ID=your_app_id" >> .env
echo "PRIMUS_APP_SECRET=your_app_secret" >> .env

# Generate attestation
yarn generate

# The attestation is saved to testdata/attestation.json
```

**Trust assumptions:**
- **Primus attester identity** is pinned at deployment (Poseidon2 hash of the attester's secp256k1 public key stored in contract). Attestations from unknown signers are rejected.
- **MPC-TLS** prevents either party (client or attester) from forging TLS data unilaterally. In contrast, proxy-TLS mode trusts the attester to actually communicate with the intended server.
- **CoinGecko** is trusted as the price data source. The contract whitelists allowed API URLs via Poseidon2 hashes.
- **Resolution window** (7 days) limits the use of stale attestations.
- **Attestation freshness** is enforced: the attestation timestamp must be after market expiry.

## Web Interface

A React webapp for interacting with the prediction market in the browser.

### Running the Webapp

```bash
# Prerequisites: compile the contract first
yarn ccc

# Install webapp dependencies
cd webapp
yarn install

# Start dev server
yarn dev
# Opens at http://localhost:5173
```

For production builds:

```bash
cd webapp
yarn build
yarn preview
```

### Wallet Modes

The webapp supports two wallet modes:

**Embedded Wallet** (for local development)
- Creates 3 ephemeral in-browser accounts: Admin, Alice, Bob
- Uses SponsoredFPC for fee payment (no fee tokens needed)
- Point it at your local Aztec node (`http://localhost:8080`)
- Best for testing the full flow without any external setup

**Extension Wallet** (for connecting to a real wallet)
- Discovers Aztec wallet browser extensions via `@aztec/wallet-sdk`
- Establishes secure channel with ECDH key exchange
- Shows emoji verification code to confirm the connection
- Requests capabilities (accounts, contracts, simulation, transactions)
- Works with any compatible Aztec wallet extension

### Workflow

1. **Connect** -- Choose embedded or extension wallet mode and connect
2. **Markets** -- View all active markets, create new ones, or join existing markets by contract address
3. **Seed Liquidity** -- Deposit collateral to seed the AMM pool (required before trading)
4. **Buy YES / Buy NO** -- Click "Buy YES" or "Buy NO" to take a position. The AMM prices shares based on pool reserves and handles the other side automatically. Prices update in real-time.
5. **Resolve** -- After market expiry, anyone submits a Primus zkTLS attestation to settle the market
6. **Claim Payout** -- Winners redeem shares 1:1 for collateral tokens

The "Advanced" section also exposes manual deposit/withdraw (complete sets) for power users.

### Requirements

- **Aztec local network**: `aztec start --local-network` (for embedded wallet mode)
- **Compiled contract**: Run `yarn ccc` in the project root before starting the webapp
- **Node.js 22+**
- **Browser with SharedArrayBuffer support**: The dev server sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers for WASM multithreading

## Project Structure

```
prediction-market-zktls/
|-- src/
|   |-- main.nr          # Contract: complete sets, AMM, token integration, resolution
|   |-- amm.nr           # CPMM pricing math + unit tests (13 tests)
|   |-- config.nr         # Constants
|   +-- price.nr          # ASCII price parser + unit tests (8 tests)
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
|-- webapp/
|   |-- src/
|   |   |-- App.tsx               # Main UI: markets, AMM trading, resolve
|   |   |-- aztec.ts              # Embedded wallet setup + SponsoredFPC
|   |   |-- wallet-connection.ts  # Extension wallet discovery + connection
|   |   |-- attestation.ts        # Browser-compatible attestation parser
|   |   |-- generate-attestation.ts  # In-browser attestation generation via Primus JS SDK
|   |   +-- url-hashes.ts         # Poseidon2 URL/key hash computation
|   |-- index.html
|   |-- vite.config.ts
|   +-- package.json
|-- Nargo.toml
+-- package.json
```
