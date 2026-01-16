# DAO Voting with Tiered Voting Power

A private DAO voting contract for Aztec that uses Ethereum storage proofs to verify token holdings while preserving voter privacy through tiered voting power.

## Overview

This contract enables private voting on proposals where voting power is determined by ERC20 token balances on Ethereum L1. Instead of using exact token balances (which could de-anonymize voters), the contract uses **tiered voting power** - voters prove they belong to a tier (e.g., "1,000-10,000 tokens") without revealing their exact balance.

## Privacy Model

| Data | Privacy Level | Notes |
|------|--------------|-------|
| Vote choice | **Private** | Hidden in VoteNote |
| Exact L1 balance | **Private** | Only tier is verified |
| Voter's tier | Semi-private | Provides k-anonymity |
| Voter Aztec identity | **Private** | Not linked to tally |
| L1 ↔ Aztec linkage | **Protected** | Harder to correlate |
| Proposal details | Public | Times, snapshot block |
| Vote tallies | Public | Aggregate per choice |

## Tiered Voting Power

### Tier Configuration

| Tier | Balance Range | Voting Power |
|------|---------------|--------------|
| 0 | 0 (no tokens) | 0 (cannot vote) |
| 1 | 1 - 999 | 1 |
| 2 | 1,000 - 9,999 | 5 |
| 3 | 10,000 - 99,999 | 25 |
| 4 | 100,000+ | 100 |

### Why Tiers?

1. **Privacy**: Exact balance hidden, only tier revealed
2. **k-Anonymity**: Users in same tier are indistinguishable
3. **Anti-plutocracy**: Whale influence capped at tier 4
4. **Correlation resistance**: Harder to link L1 wallet to Aztec identity

## Prerequisites

```bash
# Install Aztec tools
bash -i <(curl -s https://install.aztec.network)
aztec-up 3.0.0-devnet.20251212

# Install nargo for Noir compilation (if not using aztec compile)
noirup -v 1.0.0-beta.15
```

## Building

```bash
# Compile the contract
aztec compile

# Generate TypeScript bindings
aztec codegen target -o artifacts

# Or use the combined command
npm run compile
```

## Testing

### Unit Tests (Noir)

```bash
# Start TXE (Testing Execution Environment)
aztec start --txe --port=8081

# Run Noir tests
aztec test
```

### Integration Tests (TypeScript)

```bash
# Install dependencies
npm install

# Start local Aztec network (in separate terminal)
aztec start --local-network

# Run tests
npm test
```

## Contract Interface

### Initialization

```noir
fn constructor(
    admin: AztecAddress,           // Who can create proposals
    eth_token_address: [u8; 20],   // ERC20 token on Ethereum
    eth_balance_slot: Field,       // Storage slot for balances
    eth_chain_id: u32,             // Chain ID (1 for mainnet)
)
```

### Creating Proposals

```noir
fn create_proposal(
    description_hash: Field,  // Hash of off-chain description
    snapshot_block: u64,      // Ethereum block for balance snapshot
    voting_start: u64,        // Unix timestamp
    voting_end: u64,          // Unix timestamp
    num_choices: u8,          // 2-8 choices
) -> Field  // Returns proposal_id
```

### Casting Votes

```noir
fn cast_vote(
    proposal_id: Field,
    choice: u8,               // 0 to num_choices-1
    eth_address: [u8; 20],    // Voter's Ethereum address
    claimed_tier: u8,         // Tier voter claims to be in (1-4)
)
```

### View Functions

- `get_proposal(proposal_id)` - Get proposal details
- `get_vote_count(proposal_id, choice)` - Get votes for a choice
- `get_results(proposal_id)` - Get full results
- `get_tier_info(tier)` - Get tier configuration
- `get_all_tiers()` - Get all tier configurations

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Ethereum L1                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ERC20 Token Contract                           │   │
│  │  - balances[address] = amount                   │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
                          │ eth-proofs (storage proofs)
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    Aztec L2                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │  DaoVoting Contract                             │   │
│  │                                                 │   │
│  │  Private:                                       │   │
│  │  - cast_vote() verifies tier, creates nullifier│   │
│  │  - Vote choice hidden in VoteNote              │   │
│  │                                                 │   │
│  │  Public:                                        │   │
│  │  - Proposals stored publicly                   │   │
│  │  - Vote tallies aggregated per choice          │   │
│  │  - _update_tally() validates and updates       │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## eth-proofs Integration

**Note**: The eth-proofs integration is currently stubbed out due to version compatibility issues with Aztec v3.

### Correct Import Paths

When compatibility is resolved, add to `Nargo.toml`:

```toml
# Core Ethereum types and proof verification
ethereum = { git = "https://github.com/noir-lang/eth-proofs", tag = "main", directory = "ethereum/circuits/lib" }

# ERC20 token support (get_balance, token_list)
token = { git = "https://github.com/noir-lang/eth-proofs", tag = "main", directory = "vlayer/ethereum/circuits/lib" }
```

### Usage in Noir

```noir
use dep::ethereum::misc::types::Address;
use dep::token::token::ERC20;
use dep::token::token_list::mainnet::USDC;

// Option 1: Use predefined token (USDC)
let balance: u128 = USDC.get_balance(wallet_address, block_number, false);

// Option 2: Custom token
let token = ERC20 {
    address: token_address,
    balances_slot: 9,  // varies by token
    allowances_slot: 0,
    chain_id: 1,  // mainnet
};
let balance: u128 = token.get_balance(wallet_address, block_number, false);
```

### Enabling Full Integration

1. Uncomment eth-proofs dependencies in `Nargo.toml`
2. Uncomment imports in `src/main.nr`
3. Uncomment balance verification code in `cast_vote` function
4. Run eth-proofs oracle server with Ethereum RPC access

Track compatibility progress at: https://github.com/noir-lang/eth-proofs

## Security Considerations

1. **Tier Enforcement**: Users must claim the correct tier - they cannot claim lower to hide wealth or higher without sufficient balance

2. **Nullifier Strategy**: `nullifier = hash(proposal_id, eth_address)` prevents:
   - Same ETH address voting twice on same proposal
   - Vote splitting across multiple Aztec accounts

3. **Time Validation**: Voting period is validated in the public function at execution time

4. **Admin Controls**: Only admin can create/cancel proposals

## Limitations

- Requires eth-proofs oracle for L1 balance verification
- Balance snapshot is at specific block, not real-time
- Tier boundaries are public (attackers know the ranges)
- Users at tier boundaries may be slightly less anonymous

## License

MIT
