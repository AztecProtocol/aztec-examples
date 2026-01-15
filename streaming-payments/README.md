# Streaming Payments Contract

A streaming payments contract for Aztec that enables:
- Salary streaming
- Token vesting
- Subscription payments

Token balances remain private while stream metadata is stored publicly for both parties to access.

## Features

- **Linear Vesting**: Tokens unlock linearly from start to end time
- **Cliff Period**: Optional cliff before which no tokens can be withdrawn
- **Public Stream Registry**: Stream parameters stored publicly so both sender and recipient can interact
- **Private Token Balances**: Actual token amounts remain in private balances
- **Cancellation**: Sender can cancel and reclaim unvested tokens
- **Partial Withdrawals**: Recipient can withdraw any unlocked amount
- **Full Token Integration**: Uses the defi-wonderland/aztec-standards Token contract

## Architecture

### Storage

```
Storage:
├── token: PublicImmutable<AztecAddress>       # Token contract address
└── streams: Map<Field, PublicMutable<StreamData>>  # Public stream registry
```

### StreamData

Each stream is stored publicly with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| sender | AztecAddress | Stream creator (can cancel) |
| recipient | AztecAddress | Token recipient |
| total_amount | u128 | Total tokens to stream |
| start_time | u64 | When streaming begins |
| end_time | u64 | When fully vested |
| cliff_time | u64 | No withdrawals before this |
| claimed_amount | u128 | Already withdrawn |
| cancelled | bool | Whether stream was cancelled |

### Key Functions

| Function | Visibility | Description |
|----------|------------|-------------|
| `constructor(token)` | public | Initialize with token address |
| `create_stream(...)` | private | Create a new stream (requires authwit) |
| `withdraw(stream_id, amount)` | private | Withdraw unlocked tokens |
| `cancel_stream(stream_id, unvested_amount)` | private | Cancel and reclaim unvested |
| `get_stream_info(...)` | utility | View stream details |
| `get_withdrawable(...)` | utility | Calculate withdrawable amount |
| `get_unvested(...)` | utility | Calculate unvested amount |

## Privacy Model

**Private** (hidden from observers):
- Token balances (sender's source, recipient's destination)
- Individual withdrawal/cancellation amounts going to private balances

**Public** (visible on-chain):
- Stream existence and parameters
- Sender and recipient addresses
- Vesting schedule (start, end, cliff times)
- Total stream amount
- Claimed amount and cancellation status

### Design Rationale

The public stream registry approach was chosen because:
1. **Both parties need access**: The sender needs to cancel, the recipient needs to withdraw
2. **Note ownership limitation**: In Aztec, only the note owner can nullify their notes
3. **Practical privacy**: For most use cases (payroll, vesting), stream existence isn't secret - what matters is keeping actual balances private

## Usage

### Prerequisites

```bash
# Install Aztec tools
bash -i <(curl -s https://install.aztec.network)
aztec-up 3.0.0-devnet.20251212
```

### Setup

The project uses a workspace structure with the Token contract as a dependency. Run the setup script to download and compile everything:

```bash
./scripts/setup-token.sh
```

This will:
1. Clone the Token contract from [defi-wonderland/aztec-standards](https://github.com/defi-wonderland/aztec-standards)
2. Compile both contracts in the workspace
3. Generate TypeScript bindings in `artifacts/`

### Build (Manual)

If you've already run setup, you can rebuild with:

```bash
aztec compile --workspace
aztec codegen target -o artifacts
```

### Test

#### Noir Tests (TXE)

Run all Noir tests including integration tests with the Token contract:

```bash
aztec test --package streaming_payments_contract
```

This runs 15 tests:
- 11 unit tests for vesting calculations
- 4 integration tests with full token transfers

#### TypeScript Tests (requires running node)

```bash
# Start Aztec local network first
aztec start --local-network

# In another terminal, run tests
npm install
npm test
```

### Example Flow

1. **Deploy Token**: Deploy a Token contract with minting capability

2. **Deploy StreamingPayments**: Deploy with the token address
   ```
   StreamingPayments.constructor(token_address)
   ```

3. **Mint Tokens**: Mint tokens to the sender's private balance

4. **Create Stream**: Sender creates a stream (requires authwit for token transfer)
   ```
   // Create authwit for transfer_private_to_public
   create_stream(recipient, 1000, start, end, cliff, nonce) -> stream_id
   ```

5. **Time Passes**: After vesting period, tokens become withdrawable

6. **Withdraw**: Recipient withdraws vested tokens to their private balance
   ```
   withdraw(stream_id, amount)
   ```

7. **Cancel** (optional): Sender cancels and reclaims unvested tokens
   ```
   // First query unvested amount
   let unvested = get_unvested(stream_id, current_time)
   cancel_stream(stream_id, unvested)
   ```

## Linear Vesting Formula

```
unlocked = total_amount * (current_time - start_time) / (end_time - start_time)
```

Where:
- Before `cliff_time`: `unlocked = 0`
- After `end_time`: `unlocked = total_amount`

## Token Integration

This contract integrates with the [aztec-standards Token contract](https://github.com/defi-wonderland/aztec-standards):

- **create_stream**: Transfers tokens from sender's private balance to contract's public balance using `transfer_private_to_public` with authwit
- **withdraw**: Transfers tokens from contract's public balance to recipient's private balance using `transfer_public_to_private`
- **cancel_stream**: Returns unvested tokens to sender's private balance

### Authwit (Authorization Witness)

Creating a stream requires the sender to authorize the contract to transfer tokens on their behalf:

```noir
// 1. Create the transfer call
let transfer_call = Token::at(token).transfer_private_to_public(
    sender, streaming_contract, amount, nonce
);

// 2. Add authwit
add_private_authwit_from_call(env, sender, streaming_contract, transfer_call);

// 3. Create stream (uses the same nonce)
StreamingPayments::at(streaming_contract).create_stream(
    recipient, amount, start, end, cliff, nonce
);
```

## File Structure

```
streaming-payments/
├── Nargo.toml                    # Workspace configuration
├── README.md                     # This file
├── package.json                  # NPM dependencies for tests
├── contracts/
│   └── streaming_payments/
│       ├── Nargo.toml           # Contract dependencies
│       └── src/
│           ├── main.nr          # Main contract
│           ├── lib.nr           # StreamData type + pure functions + tests
│           └── stream_note.nr   # Legacy StreamNote type (unused)
├── scripts/
│   └── setup-token.sh           # Setup script
├── tests/
│   └── streaming_payments.test.ts  # TypeScript integration tests
├── .deps/                        # Downloaded dependencies (gitignored)
│   └── token_contract/          # Token contract from aztec-standards
├── target/                       # Compiled artifacts (gitignored)
└── artifacts/                    # TypeScript bindings (gitignored)
```

## Dependencies

- Aztec v3.0.0-devnet.20251212
- Token contract from [defi-wonderland/aztec-standards](https://github.com/defi-wonderland/aztec-standards) (dev branch)

## Related Patterns

- **Token Contract**: For actual token transfers
- **Crowdfunding**: Similar time-based private payments
- **Private Voting**: Uses similar public/private hybrid patterns
