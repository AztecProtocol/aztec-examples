# Private Prediction Market with zkTLS Resolution

A private prediction market on Aztec where bets are hidden, resolution is trustless via zkTLS, and settlement is private.

## What This Does

- **Private betting**: No one sees who bet what, how much, or which direction
- **Trustless resolution**: Market resolves via a Primus zkTLS attestation proving a real-world price from CoinGecko's API — no oracle network needed
- **Private settlement**: Winners redeem shares for collateral without revealing their identity

## How It Works

### Market Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│  1. DEPLOY                                                       │
│     Admin creates market: "BTC above $100k by July 1?"          │
│     Sets: threshold, expiry, CoinGecko URL hash                 │
├─────────────────────────────────────────────────────────────────┤
│  2. BETTING (private)                                            │
│     Alice deposits collateral → buys YES shares                 │
│     Bob deposits collateral → buys NO shares                    │
│     ⚡ Identity hidden via partial notes                         │
│     📈 CSMM pricing adjusts based on demand                     │
├─────────────────────────────────────────────────────────────────┤
│  3. RESOLUTION (after expiry)                                    │
│     Anyone submits CoinGecko zkTLS attestation                  │
│     Contract verifies: signature ✓ URL ✓ price extraction ✓    │
│     Compares price against threshold → YES or NO wins           │
├─────────────────────────────────────────────────────────────────┤
│  4. SETTLEMENT (private)                                         │
│     Winners call redeem() → shares burned, collateral returned  │
│     All via private notes — no one knows who won                │
└─────────────────────────────────────────────────────────────────┘
```

### Privacy Model

| Data | Privacy | Notes |
|------|---------|-------|
| Bettor identity | **PRIVATE** | Hidden via partial notes |
| Position size | **PRIVATE** | Stored as encrypted notes |
| Bet direction | **PRIVATE** | Not revealed until settlement |
| Collateral balances | **PRIVATE** | Only owner can read |
| Trade amounts | PUBLIC | Affects price movement |
| Resolution outcome | PUBLIC | Everyone needs to know who won |
| Resolved price | PUBLIC | Proven via zkTLS attestation |

### Why This Is Better Than Polymarket

- **Position privacy** — no one front-runs or copies your bets
- **Censorship resistance** — no central operator to shut down markets
- **Trustless resolution** — zkTLS attestation from CoinGecko vs relying on oracle networks
- **Simple trust assumption** — attestor only proves "this data came from this URL"

## Quick Start

### Prerequisites

```bash
# Install Aztec tools
bash -i <(curl -s https://install.aztec.network)
aztec-up 4.2.0-aztecnr-rc.2

# Install dependencies
yarn install
```

### Build

```bash
# Compile contract and generate TypeScript bindings
yarn ccc
```

### Run Noir Unit Tests

```bash
# Tests CSMM pricing and price parser
yarn test:noir
```

### Generate a Price Attestation

```bash
# Needs PRIMUS_APP_ID and PRIMUS_APP_SECRET in .env
# Get credentials from https://dev.primuslabs.xyz
yarn generate
```

### Run Full Lifecycle Demo

```bash
# Start Aztec local network (in separate terminal)
aztec start --local-network

# Deploy, bet, resolve, redeem
yarn demo
```

### Run Integration Tests

```bash
# Start Aztec local network first
aztec start --local-network

# Run tests
yarn test
```

## Architecture

### Contract (`src/main.nr`)

**Storage:**
- `collateral_balances`, `yes_balances`, `no_balances` — private (note-based)
- `yes_supply`, `no_supply`, `total_liquidity`, `admin` — public (AMM state)
- `config: PublicImmutable<MarketConfig>` — market parameters (readable from private)
- `resolution: PublicImmutable<Resolution>` — outcome (initialized once at resolution)

**Key Functions:**
- `deposit(amount)` / `withdraw(amount)` — private collateral management
- `buy_outcome(is_yes, amount, min_shares)` — private bet via partial notes
- `resolve_market(…attestation…)` — public zkTLS verification + outcome determination
- `redeem(amount)` — private settlement (burn winning shares → receive collateral)

### Pricing: Constant Sum Market Maker (CSMM)

```
price_YES = yes_supply / (yes_supply + no_supply)
price_NO = no_supply / (yes_supply + no_supply)
price_YES + price_NO = 1  (always)

shares_out = collateral_in / current_price
```

### zkTLS Resolution

Uses [Primus zkTLS](https://primuslabs.xyz) attestations verified by [`att_verifier_lib`](https://github.com/primus-labs/zktls-verification-noir):

1. After market expiry, anyone fetches BTC price from CoinGecko via Primus
2. Primus attestor signs: "CoinGecko returned this price at this URL"
3. Contract verifies ECDSA signature, SHA256 content hashes, URL whitelist
4. Parses ASCII price → integer cents, compares against threshold
5. `PublicImmutable<Resolution>` initialized once (prevents double-resolution)

### CoinGecko API

```
URL: https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd
Response: {"bitcoin":{"usd":97234.56}}
JSONPath: $.bitcoin.usd → "97234.56"
Parsed: 9723456 (cents)
```

## Project Structure

```
prediction-market-zktls/
├── src/
│   ├── main.nr          # Contract: betting, resolution, settlement
│   ├── config.nr         # MarketConfig + Resolution structs
│   ├── lib.nr            # CSMM pricing functions + unit tests
│   └── price.nr          # ASCII price parser + unit tests
├── scripts/
│   ├── parse_attestation.ts     # Attestation → contract args
│   ├── compute_url_hashes.ts    # Poseidon2 URL hashing
│   ├── generate_attestation.ts  # CoinGecko attestation generator
│   ├── deploy_and_resolve.ts    # Full lifecycle demo
│   └── sponsored_fpc.ts         # Fee payment helper
├── tests/
│   └── prediction_market_zktls.test.ts  # Integration tests
├── testdata/
│   └── sample-attestation.json  # Example format
├── Nargo.toml            # Noir/Aztec dependencies
└── package.json          # TypeScript dependencies
```
