# Prediction Market Contract

A prediction market implementation on Aztec using a **Constant Sum Market Maker (CSMM)** for binary outcomes with **full identity privacy**.

## Overview

This contract allows users to:
- **Bet on binary outcomes** (YES/NO) **anonymously** - no one knows WHO placed a bet
- **Hold fully private balances** - collateral and share holdings are all hidden
- **Experience dynamic pricing** that adjusts based on market sentiment
- **Get slippage protection** to prevent adverse price movements
- **Single-transaction betting** using partial notes pattern

## Privacy Model

### What's Private

| Data | Privacy | Notes |
|------|---------|-------|
| Bettor identity | **PRIVATE** | Public function doesn't receive sender address |
| Collateral balances | **PRIVATE** | Stored as private notes (UintNote) |
| Share balances | **PRIVATE** | Stored as private notes (UintNote) |
| Your bet (YES/NO) | **PRIVATE** | Hidden via partial notes |

### What's Public

| Data | Visibility | Why |
|------|------------|-----|
| Price changes | PUBLIC | Necessary for AMM pricing |
| Trade amounts | PUBLIC | Affects price movement |
| That someone bought YES/NO | PUBLIC | Observable from price changes |

### Privacy Architecture

The contract uses **partial notes** for private betting (like the [AMM contract](https://github.com/AztecProtocol/aztec-packages/tree/master/noir-projects/noir-contracts/contracts/amm_contract)):

```
1. buy_outcome() [PRIVATE]
   |
   +-- Consumes private collateral notes
   +-- Creates change note if needed
   +-- Creates partial note commitment (hides owner)
   +-- Enqueues public call WITHOUT sender address
   v
2. _process_buy() [PUBLIC]
   |
   +-- Calculates shares based on CSMM pricing
   +-- Updates YES/NO supplies (price changes)
   +-- Completes partial note with share amount
   v
   Shares appear in user's private balance (single tx!)
```

Key privacy feature: The public `_process_buy()` function **does not receive the sender address**. It only knows WHAT was traded, not WHO traded.

## Usage

### Betting Flow (Single Transaction)

```typescript
// Deposit collateral privately
await market.methods.deposit(1000n).send({ from: myAddress }).wait()

// Buy outcome privately - single transaction!
await market.methods.buy_outcome(
  true,    // is_yes
  500n,    // collateral_amount
  900n,    // min_shares_out (slippage protection)
).send({ from: myAddress }).wait()

// Your shares are immediately in your private balance!
const myBalance = await market.methods.get_yes_balance(myAddress).simulate({ from: myAddress })
```

### Collateral Management (All Private)

```typescript
// Deposit collateral (private)
await market.methods.deposit(1000n).send({ from: myAddress }).wait()

// Withdraw collateral (private)
await market.methods.withdraw(500n).send({ from: myAddress }).wait()

// Check balance (view private notes)
const balance = await market.methods.get_collateral_balance(myAddress).simulate({ from: myAddress })
```

## Development

### Prerequisites

```bash
# Install Aztec tools
bash -i <(curl -s https://install.aztec.network)
aztec-up 3.0.0-devnet.20251212

# Install dependencies
yarn install
```

### Building

```bash
# Compile the contract
aztec compile

# Generate TypeScript bindings
aztec codegen target -o artifacts
```

### Testing

#### Noir Unit Tests

```bash
aztec test
```

Tests the CSMM pricing functions:
- Share calculations at various price points
- Price calculations and invariants
- Edge cases

#### End-to-End Tests

```bash
# Start Aztec sandbox (in separate terminal)
aztec start --sandbox

# Run tests
yarn test
```

Tests the full private betting flow:
- Contract deployment
- Private deposit/withdraw
- Private buy_outcome (single tx with partial notes)
- Price movements
- Balance privacy

## Constant Sum Market Maker (CSMM)

### Core Invariant
```
price_YES + price_NO = 1
```

### Pricing Formula
```
price_YES = yes_supply / (yes_supply + no_supply)
shares_out = collateral_in / current_price
```

### Example

```
Initial: YES=5000, NO=5000, price_YES=50%

Alice buys 1000 collateral of YES:
- Shares received: 1000 / 0.50 = 2000 YES
- New YES supply: 7000
- New price_YES: 7000 / 12000 = 58.3%
```
