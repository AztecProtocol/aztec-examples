/// Pure computation functions for streaming payments
///
/// These functions can be tested without the aztec context.

/// Calculate how many tokens are unlocked at a given timestamp
///
/// # Arguments
/// * `total_amount` - Total tokens in the stream
/// * `start_time` - Unix timestamp when streaming starts
/// * `end_time` - Unix timestamp when streaming ends
/// * `cliff_time` - Unix timestamp before which nothing is unlocked
/// * `current_time` - Current timestamp to calculate unlocked amount
///
/// # Returns
/// The amount of tokens unlocked at current_time
pub fn compute_unlocked_amount(
    total_amount: u128,
    start_time: u64,
    end_time: u64,
    cliff_time: u64,
    current_time: u64,
) -> u128 {
    // Before cliff, nothing is unlocked
    if current_time < cliff_time {
        0
    } else if current_time >= end_time {
        // After end time, everything is unlocked
        total_amount
    } else {
        // Linear vesting between start and end
        let elapsed = current_time - start_time;
        let duration = end_time - start_time;
        // Linear interpolation: (total_amount * elapsed) / duration
        (total_amount * (elapsed as u128)) / (duration as u128)
    }
}

/// Calculate how many tokens can be withdrawn
///
/// # Arguments
/// * `unlocked` - Amount currently unlocked
/// * `claimed` - Amount already claimed
///
/// # Returns
/// The amount available for withdrawal
pub fn compute_withdrawable_amount(unlocked: u128, claimed: u128) -> u128 {
    if unlocked > claimed {
        unlocked - claimed
    } else {
        0
    }
}

/// Calculate vested and unvested amounts for a stream cancellation
///
/// # Arguments
/// * `total_amount` - Total tokens in the stream
/// * `start_time` - Unix timestamp when streaming started
/// * `end_time` - Unix timestamp when streaming ends
/// * `cliff_time` - Cliff timestamp
/// * `current_time` - Current timestamp when cancelling
/// * `claimed_amount` - Amount already claimed by recipient
///
/// # Returns
/// (vested, unvested, unclaimed_vested) where:
/// - vested: total amount vested so far
/// - unvested: amount that goes back to sender
/// - unclaimed_vested: vested amount still available to recipient
pub fn compute_cancellation_amounts(
    total_amount: u128,
    start_time: u64,
    end_time: u64,
    cliff_time: u64,
    current_time: u64,
    claimed_amount: u128,
) -> (u128, u128, u128) {
    let vested = compute_unlocked_amount(total_amount, start_time, end_time, cliff_time, current_time);
    let unvested = total_amount - vested;
    let unclaimed_vested = vested - claimed_amount;
    (vested, unvested, unclaimed_vested)
}

// ============================================================================
// TESTS
// ============================================================================

#[test]
fn test_compute_unlocked_before_cliff() {
    // Stream: 1000 tokens, starts at 100, ends at 200, cliff at 150
    let total = 1000;
    let start = 100;
    let end = 200;
    let cliff = 150;

    // At time 120 (before cliff), nothing unlocked
    let unlocked = compute_unlocked_amount(total, start, end, cliff, 120);
    assert(unlocked == 0, "Before cliff should return 0");
}

#[test]
fn test_compute_unlocked_at_cliff() {
    // Stream: 1000 tokens, starts at 100, ends at 200, cliff at 150
    let total = 1000;
    let start = 100;
    let end = 200;
    let cliff = 150;

    // At time 150 (exactly at cliff), 50% elapsed
    // elapsed = 150 - 100 = 50
    // duration = 200 - 100 = 100
    // unlocked = 1000 * 50 / 100 = 500
    let unlocked = compute_unlocked_amount(total, start, end, cliff, 150);
    assert(unlocked == 500, "At cliff (50% through) should unlock 500");
}

#[test]
fn test_compute_unlocked_mid_stream() {
    // Stream: 1000 tokens, starts at 0, ends at 100, no cliff
    let total = 1000;
    let start = 0;
    let end = 100;
    let cliff = 0;

    // At time 25 (25% through)
    let unlocked = compute_unlocked_amount(total, start, end, cliff, 25);
    assert(unlocked == 250, "At 25% should unlock 250");

    // At time 75 (75% through)
    let unlocked2 = compute_unlocked_amount(total, start, end, cliff, 75);
    assert(unlocked2 == 750, "At 75% should unlock 750");
}

#[test]
fn test_compute_unlocked_after_end() {
    // Stream: 1000 tokens, starts at 100, ends at 200
    let total = 1000;
    let start = 100;
    let end = 200;
    let cliff = 100;

    // At time 300 (after end), everything unlocked
    let unlocked = compute_unlocked_amount(total, start, end, cliff, 300);
    assert(unlocked == total, "After end should unlock everything");
}

#[test]
fn test_compute_unlocked_exactly_at_end() {
    // Stream: 1000 tokens, starts at 100, ends at 200
    let total = 1000;
    let start = 100;
    let end = 200;
    let cliff = 100;

    // At exactly end time
    let unlocked = compute_unlocked_amount(total, start, end, cliff, 200);
    assert(unlocked == total, "At exactly end should unlock everything");
}

#[test]
fn test_compute_withdrawable_nothing_claimed() {
    let unlocked = 500;
    let claimed = 0;

    let withdrawable = compute_withdrawable_amount(unlocked, claimed);
    assert(withdrawable == 500, "With nothing claimed, all unlocked is withdrawable");
}

#[test]
fn test_compute_withdrawable_partial_claimed() {
    let unlocked = 500;
    let claimed = 200;

    let withdrawable = compute_withdrawable_amount(unlocked, claimed);
    assert(withdrawable == 300, "Should be unlocked minus claimed");
}

#[test]
fn test_compute_withdrawable_all_claimed() {
    let unlocked = 500;
    let claimed = 500;

    let withdrawable = compute_withdrawable_amount(unlocked, claimed);
    assert(withdrawable == 0, "With all claimed, nothing withdrawable");
}

#[test]
fn test_compute_cancellation_mid_stream() {
    // Stream: 1000 tokens, starts at 0, ends at 100, no cliff
    // Cancel at time 30 (30% vested), with 100 already claimed
    let total = 1000;
    let start = 0;
    let end = 100;
    let cliff = 0;
    let current = 30;
    let claimed = 100;

    let (vested, unvested, unclaimed_vested) =
        compute_cancellation_amounts(total, start, end, cliff, current, claimed);

    assert(vested == 300, "30% vested = 300");
    assert(unvested == 700, "70% unvested = 700 (returns to sender)");
    assert(unclaimed_vested == 200, "300 vested - 100 claimed = 200 (still for recipient)");
}

#[test]
fn test_compute_cancellation_nothing_claimed() {
    // Stream: 1000 tokens, 50% vested, nothing claimed
    let total = 1000;
    let start = 0;
    let end = 100;
    let cliff = 0;
    let current = 50;
    let claimed = 0;

    let (vested, unvested, unclaimed_vested) =
        compute_cancellation_amounts(total, start, end, cliff, current, claimed);

    assert(vested == 500, "50% vested = 500");
    assert(unvested == 500, "50% unvested = 500");
    assert(unclaimed_vested == 500, "All vested is unclaimed");
}

#[test]
fn test_linear_vesting_precision() {
    // Test that linear vesting works correctly with various amounts
    let total: u128 = 1_000_000;
    let start: u64 = 0;
    let end: u64 = 365 * 24 * 60 * 60; // 1 year in seconds
    let cliff: u64 = 0;

    // After 1 month (~30 days)
    let one_month: u64 = 30 * 24 * 60 * 60;
    let unlocked_1m = compute_unlocked_amount(total, start, end, cliff, one_month);
    // Expected: 1_000_000 * (30*24*60*60) / (365*24*60*60) = ~82,191
    assert(unlocked_1m > 80000, "After 1 month should unlock ~8.2%");
    assert(unlocked_1m < 85000, "After 1 month should unlock ~8.2%");

    // After 6 months
    let six_months: u64 = 182 * 24 * 60 * 60;
    let unlocked_6m = compute_unlocked_amount(total, start, end, cliff, six_months);
    // Expected: ~49.9%
    assert(unlocked_6m > 490000, "After 6 months should unlock ~50%");
    assert(unlocked_6m < 510000, "After 6 months should unlock ~50%");
}

// ============================================================================
// INTEGRATION TESTS (with Token contract)
// ============================================================================
//
// NOTE: These tests require the Token contract to be compiled locally.
// The TXE (Test eXecution Environment) needs the compiled artifact in the target folder.
//
// To run these tests:
// 1. Clone the aztec-standards repo: git clone https://github.com/defi-wonderland/aztec-standards
// 2. Compile the token contract: cd aztec-standards && aztec compile
// 3. Copy the artifact to this project's target folder
// 4. Uncomment the tests below
//
// Alternatively, set up a Nargo workspace that includes both contracts.

// Integration tests with the Token contract.
// These require the Token contract to be compiled locally in the workspace.

use crate::StreamingPayments;
use dep::aztec::{
    oracle::random::random,
    protocol_types::address::AztecAddress,
    test::helpers::{
        authwit::add_private_authwit_from_call,
        test_environment::TestEnvironment,
    },
};
use dep::token::Token;

// Stream duration for tests (1000 seconds)
global STREAM_DURATION: u64 = 1000;

/// Helper to set up test environment with deployed contracts
unconstrained fn setup_with_token() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();

    // Create accounts (contract accounts needed for authwits)
    let admin = env.create_contract_account();
    let sender = env.create_contract_account();
    let recipient = env.create_contract_account();

    // Deploy Token contract with minter
    // constructor_with_minter(name, symbol, decimals, minter, upgrade_authority)
    let token_initializer = Token::interface().constructor_with_minter(
        "StreamToken                    ", // str<31>
        "STK                            ", // str<31>
        18,
        admin, // minter
        AztecAddress::zero(), // no upgrade authority
    );
    let token_address = env.deploy("@token_contract/Token")
        .with_public_initializer(admin, token_initializer);

    // Deploy StreamingPayments contract
    let streaming_initializer = StreamingPayments::interface().constructor(token_address);
    let streaming_address = env.deploy("StreamingPayments")
        .with_public_initializer(admin, streaming_initializer);

    (env, token_address, streaming_address, admin, sender, recipient)
}

#[test]
unconstrained fn test_create_stream_with_token() {
    let (mut env, token_address, streaming_address, admin, sender, recipient) = setup_with_token();

    // Mint tokens to sender's private balance
    let total_amount: u128 = 1000;
    let mint_call = Token::at(token_address).mint_to_private(sender, total_amount);
    env.call_private(admin, mint_call);

    // Set up time parameters - use past timestamps so stream is immediately active
    // Current block time is ~1768441500, so use values in the past
    let start_time: u64 = 1_000_000_000;
    let end_time: u64 = 1_000_000_000 + STREAM_DURATION;
    let cliff_time: u64 = start_time; // No cliff

    // Random nonce for authwit
    let nonce = random();

    // Create the transfer call that streaming contract will make
    let transfer_call = Token::at(token_address).transfer_private_to_public(
        sender,
        streaming_address,
        total_amount,
        nonce,
    );

    // Authorize the streaming contract to transfer tokens on sender's behalf
    add_private_authwit_from_call(env, sender, streaming_address, transfer_call);

    // Create the stream
    let create_call = StreamingPayments::at(streaming_address).create_stream(
        recipient,
        total_amount,
        start_time,
        end_time,
        cliff_time,
        nonce,
    );
    let stream_id: Field = env.call_private(sender, create_call);

    // Verify stream was created (stream_id should be non-zero)
    assert(stream_id != 0, "Stream ID should not be zero");
}

#[test]
unconstrained fn test_withdraw_from_stream() {
    let (mut env, token_address, streaming_address, admin, sender, recipient) = setup_with_token();

    // Mint tokens to sender's private balance
    let total_amount: u128 = 1000;
    let mint_call = Token::at(token_address).mint_to_private(sender, total_amount);
    env.call_private(admin, mint_call);

    // Time parameters using past timestamps - stream is already fully vested
    // This tests that withdrawal works when everything is unlocked
    let start_time: u64 = 1_000_000_000;
    let end_time: u64 = 1_000_000_000 + STREAM_DURATION;
    let cliff_time: u64 = start_time;

    // Random nonce for authwit
    let nonce = random();

    // Authorize and create stream
    let transfer_call = Token::at(token_address).transfer_private_to_public(
        sender,
        streaming_address,
        total_amount,
        nonce,
    );
    add_private_authwit_from_call(env, sender, streaming_address, transfer_call);

    let create_call = StreamingPayments::at(streaming_address).create_stream(
        recipient,
        total_amount,
        start_time,
        end_time,
        cliff_time,
        nonce,
    );
    let stream_id: Field = env.call_private(sender, create_call);

    // Stream is already fully vested (end_time is in the past)
    // Withdraw full amount as recipient
    let withdraw_amount: u128 = total_amount;
    let withdraw_call = StreamingPayments::at(streaming_address).withdraw(
        stream_id,
        withdraw_amount,
    );
    env.call_private(recipient, withdraw_call);

    // Verify recipient received tokens in their private balance
    let balance: u128 = env.simulate_utility(Token::at(token_address).balance_of_private(recipient));
    assert(balance == withdraw_amount, "Recipient should have withdrawn tokens");
}

#[test]
unconstrained fn test_cancel_stream() {
    let (mut env, token_address, streaming_address, admin, sender, recipient) = setup_with_token();

    // Mint tokens to sender's private balance
    let total_amount: u128 = 1000;
    let mint_call = Token::at(token_address).mint_to_private(sender, total_amount);
    env.call_private(admin, mint_call);

    // Time parameters using past timestamps - stream is already fully vested
    // When we cancel a fully vested stream, unvested_amount = 0
    let start_time: u64 = 1_000_000_000;
    let end_time: u64 = 1_000_000_000 + STREAM_DURATION;
    let cliff_time: u64 = start_time;

    // Random nonce for authwit
    let nonce = random();

    // Authorize and create stream
    let transfer_call = Token::at(token_address).transfer_private_to_public(
        sender,
        streaming_address,
        total_amount,
        nonce,
    );
    add_private_authwit_from_call(env, sender, streaming_address, transfer_call);

    let create_call = StreamingPayments::at(streaming_address).create_stream(
        recipient,
        total_amount,
        start_time,
        end_time,
        cliff_time,
        nonce,
    );
    let stream_id: Field = env.call_private(sender, create_call);

    // Stream is already fully vested - cancel with unvested_amount = 0
    // This tests that cancellation works for a fully vested stream
    let unvested_amount: u128 = 0;
    let cancel_call = StreamingPayments::at(streaming_address).cancel_stream(
        stream_id,
        recipient,
        unvested_amount,
    );
    env.call_private(sender, cancel_call);

    // Sender should receive nothing back (all vested)
    let sender_balance: u128 = env.simulate_utility(Token::at(token_address).balance_of_private(sender));
    assert(sender_balance == unvested_amount, "Sender should receive unvested tokens (0)");
}

#[test]
unconstrained fn test_full_stream_lifecycle() {
    let (mut env, token_address, streaming_address, admin, sender, recipient) = setup_with_token();

    // Mint tokens
    let total_amount: u128 = 1000;
    let mint_call = Token::at(token_address).mint_to_private(sender, total_amount);
    env.call_private(admin, mint_call);

    // Time parameters using past timestamps - stream is already fully vested
    // This tests the full withdrawal lifecycle for a completed stream
    let start_time: u64 = 1_000_000_000;
    let end_time: u64 = 1_000_000_000 + STREAM_DURATION;
    let cliff_time: u64 = start_time; // No cliff (cliff already passed)

    // Random nonce
    let nonce = random();

    // Create stream with authwit
    let transfer_call = Token::at(token_address).transfer_private_to_public(
        sender,
        streaming_address,
        total_amount,
        nonce,
    );
    add_private_authwit_from_call(env, sender, streaming_address, transfer_call);

    let stream_id: Field = env.call_private(
        sender,
        StreamingPayments::at(streaming_address).create_stream(
            recipient,
            total_amount,
            start_time,
            end_time,
            cliff_time,
            nonce,
        ),
    );

    // Stream is fully vested - withdraw partial amount first
    let first_withdrawal: u128 = 200;
    env.call_private(
        recipient,
        StreamingPayments::at(streaming_address).withdraw(stream_id, first_withdrawal),
    );

    // Withdraw remaining amount
    let remaining: u128 = total_amount - first_withdrawal; // 800
    env.call_private(
        recipient,
        StreamingPayments::at(streaming_address).withdraw(stream_id, remaining),
    );

    // Verify recipient has all tokens
    let final_balance: u128 = env.simulate_utility(Token::at(token_address).balance_of_private(recipient));
    assert(final_balance == total_amount, "Recipient should have all tokens after full withdrawal");
}
