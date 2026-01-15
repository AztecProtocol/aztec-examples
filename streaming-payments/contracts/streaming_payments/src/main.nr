mod lib;
mod stream_note;

use aztec::macros::aztec;

/// Private Streaming Payments Contract
///
/// Enables salary streaming, token vesting, and subscription payments where:
/// - Token balances remain private (sender's source, recipient's destination)
/// - Stream metadata is stored publicly for both parties to access
/// - Tokens unlock linearly over time with optional cliff
/// - Recipient can withdraw unlocked portion privately
/// - Sender can cancel stream and reclaim unvested tokens
///
/// Privacy Model:
/// - Stream existence, parameters, and parties are PUBLIC
/// - Actual token balances remain PRIVATE
/// - Withdrawal/cancellation timing is visible, but destination balances are private
///
/// Token Flow:
/// - create_stream: sender private balance -> contract public balance (escrow)
/// - withdraw: contract public balance -> recipient private balance
/// - cancel: contract public balance -> sender private balance (unvested portion)
#[aztec]
pub contract StreamingPayments {
    use crate::lib::StreamData;

    use aztec::{
        macros::{functions::{external, initializer}, storage::storage},
        oracle::random::random,
        protocol_types::{
            address::AztecAddress, hash::poseidon2_hash_with_separator, traits::ToField,
        },
        state_vars::{Map, PublicImmutable, PublicMutable},
    };

    use dep::token::Token;

    /// Domain separator for stream ID generation
    global STREAM_ID_SEPARATOR: u32 = 1;

    #[storage]
    struct Storage<Context> {
        /// Token contract address for streaming payments
        token: PublicImmutable<AztecAddress, Context>,

        /// Stream data stored publicly by stream_id
        /// This allows both sender and recipient to access stream state
        streams: Map<Field, PublicMutable<StreamData, Context>, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(token: AztecAddress) {
        assert(!token.is_zero(), "Invalid token address");
        self.storage.token.initialize(token);
    }

    // =========================================================================
    // Stream Creation
    // =========================================================================

    /// Create a new payment stream from sender to recipient
    ///
    /// ## Prerequisites
    /// The sender must have created an authwit allowing this contract to call
    /// `transfer_private_to_public(sender, this_contract, total_amount, nonce)` on the token contract.
    ///
    /// # Arguments
    /// * `recipient` - Address to receive the streamed tokens
    /// * `total_amount` - Total tokens to stream
    /// * `start_time` - Unix timestamp when streaming begins
    /// * `end_time` - Unix timestamp when fully vested
    /// * `cliff_time` - Unix timestamp before which no withdrawal is allowed
    /// * `nonce` - Nonce for the authwit (must match the authwit created by sender)
    ///
    /// # Returns
    /// The stream_id of the created stream
    #[external("private")]
    fn create_stream(
        recipient: AztecAddress,
        total_amount: u128,
        start_time: u64,
        end_time: u64,
        cliff_time: u64,
        nonce: Field,
    ) -> Field {
        let sender = self.context.msg_sender().unwrap();
        let this_contract = self.context.this_address();

        // Validate inputs
        assert(!recipient.is_zero(), "Invalid recipient");
        assert(total_amount > 0, "Amount must be positive");
        assert(end_time > start_time, "End must be after start");
        assert(cliff_time >= start_time, "Cliff must be >= start");
        assert(cliff_time <= end_time, "Cliff must be <= end");

        // Transfer tokens from sender's private balance to contract's public balance (escrow)
        // Requires sender to have created an authwit for this call
        let token_address = self.storage.token.read();
        self.call(
            Token::at(token_address).transfer_private_to_public(
                sender,
                this_contract,
                total_amount,
                nonce,
            ),
        );

        // Generate unique stream_id
        // Safety: Random value is used for uniqueness, not security.
        // The stream_id is a public identifier derived from sender, recipient, and randomness.
        let random_field = unsafe { random() };
        let stream_id = poseidon2_hash_with_separator(
            [sender.to_field(), recipient.to_field(), random_field],
            STREAM_ID_SEPARATOR,
        );

        // Enqueue public call to store stream data
        self.enqueue(StreamingPayments::at(this_contract).store_stream_public(
            stream_id,
            sender,
            recipient,
            total_amount,
            start_time,
            end_time,
            cliff_time,
        ));

        stream_id
    }

    /// Store stream data publicly (called from create_stream via enqueue)
    /// Note: Only callable by this contract itself
    #[external("public")]
    fn store_stream_public(
        stream_id: Field,
        sender: AztecAddress,
        recipient: AztecAddress,
        total_amount: u128,
        start_time: u64,
        end_time: u64,
        cliff_time: u64,
    ) {
        // Verify caller is this contract (internal call only)
        assert(
            self.context.msg_sender().unwrap() == self.context.this_address(),
            "Only callable internally",
        );

        // Verify stream doesn't already exist (check sender is zero)
        let existing = self.storage.streams.at(stream_id).read();
        assert(existing.sender.is_zero(), "Stream already exists");

        let stream_data =
            StreamData::new(sender, recipient, total_amount, start_time, end_time, cliff_time);
        self.storage.streams.at(stream_id).write(stream_data);
    }

    // =========================================================================
    // Withdrawal
    // =========================================================================

    /// Withdraw unlocked tokens from a stream
    ///
    /// Transfers tokens from the contract's public escrow to the recipient's private balance.
    ///
    /// # Arguments
    /// * `stream_id` - ID of the stream to withdraw from
    /// * `amount` - Amount to withdraw (must be <= unlocked - claimed)
    #[external("private")]
    fn withdraw(stream_id: Field, amount: u128) {
        let caller = self.context.msg_sender().unwrap();
        let this_contract = self.context.this_address();

        assert(amount > 0, "Amount must be positive");

        // Get current timestamp from anchor block
        let current_time =
            self.context.get_anchor_block_header().global_variables.timestamp as u64;

        // Enqueue public call to validate and update stream state
        self.enqueue(StreamingPayments::at(this_contract).process_withdrawal_public(
            stream_id,
            caller,
            amount,
            current_time,
        ));

        // Transfer tokens from contract's public balance to recipient's private balance
        let token_address = self.storage.token.read();
        self.call(
            Token::at(token_address).transfer_public_to_private(this_contract, caller, amount, 0),
        );
    }

    /// Process withdrawal in public context (validates and updates state)
    /// Note: Only callable by this contract itself
    #[external("public")]
    fn process_withdrawal_public(
        stream_id: Field,
        caller: AztecAddress,
        amount: u128,
        current_time: u64,
    ) {
        // Verify caller is this contract (internal call only)
        assert(
            self.context.msg_sender().unwrap() == self.context.this_address(),
            "Only callable internally",
        );

        let mut stream = self.storage.streams.at(stream_id).read();

        // Verify the original caller is the recipient
        assert(stream.recipient == caller, "Not stream recipient");

        // Check stream is not cancelled
        assert(!stream.cancelled, "Stream is cancelled");

        // Check cliff has passed
        assert(current_time >= stream.cliff_time, "Cliff not reached");

        // Calculate withdrawable amount
        let withdrawable = stream.compute_withdrawable(current_time);
        assert(amount <= withdrawable, "Exceeds withdrawable amount");

        // Update claimed amount
        stream.claimed_amount += amount;
        self.storage.streams.at(stream_id).write(stream);
    }

    // =========================================================================
    // Stream Cancellation
    // =========================================================================

    /// Cancel a stream and return unvested tokens to sender
    /// Vested but unclaimed tokens remain available for recipient to claim
    ///
    /// # Arguments
    /// * `stream_id` - ID of the stream to cancel
    /// * `unvested_amount` - The unvested amount to return to sender (caller must calculate)
    ///
    /// Note: The caller must provide the correct unvested_amount. This is validated against
    /// the stream data in the public function. Use get_unvested() to calculate this value.
    #[external("private")]
    fn cancel_stream(stream_id: Field, unvested_amount: u128) {
        let caller = self.context.msg_sender().unwrap();
        let this_contract = self.context.this_address();

        // Get current timestamp
        let current_time =
            self.context.get_anchor_block_header().global_variables.timestamp as u64;

        // Enqueue public call to validate and mark stream as cancelled
        // The public function will verify the unvested_amount is correct
        self.enqueue(StreamingPayments::at(this_contract).process_cancellation_public(
            stream_id,
            caller,
            current_time,
            unvested_amount,
        ));

        // Transfer unvested tokens back to sender's private balance
        if unvested_amount > 0 {
            let token_address = self.storage.token.read();
            self.call(
                Token::at(token_address).transfer_public_to_private(
                    this_contract,
                    caller,
                    unvested_amount,
                    0,
                ),
            );
        }
    }

    /// Process stream cancellation in public context (validates and updates state)
    /// Note: Only callable by this contract itself
    #[external("public")]
    fn process_cancellation_public(
        stream_id: Field,
        caller: AztecAddress,
        current_time: u64,
        unvested_amount: u128,
    ) {
        // Verify caller is this contract (internal call only)
        assert(
            self.context.msg_sender().unwrap() == self.context.this_address(),
            "Only callable internally",
        );

        let mut stream = self.storage.streams.at(stream_id).read();

        // Verify the original caller is the sender
        assert(stream.sender == caller, "Not stream sender");

        // Verify not already cancelled
        assert(!stream.cancelled, "Stream already cancelled");

        // Calculate vested amount at cancellation time and validate unvested_amount
        let vested = stream.compute_unlocked(current_time);
        let computed_unvested = stream.total_amount - vested;
        assert(unvested_amount == computed_unvested, "Invalid unvested amount");

        // Update stream: mark cancelled and adjust total to vested amount only
        stream.cancelled = true;
        stream.total_amount = vested;
        stream.end_time = current_time;

        self.storage.streams.at(stream_id).write(stream);
    }

    // =========================================================================
    // Utility Functions (View)
    // =========================================================================

    /// Get the token contract address
    #[external("utility")]
    unconstrained fn get_token() -> pub AztecAddress {
        self.storage.token.read()
    }

    /// Get stream information
    #[external("utility")]
    unconstrained fn get_stream_info(
        stream_id: Field,
    ) -> pub (AztecAddress, AztecAddress, u128, u64, u64, u64, u128, bool) {
        let stream = self.storage.streams.at(stream_id).read();
        (
            stream.sender,
            stream.recipient,
            stream.total_amount,
            stream.start_time,
            stream.end_time,
            stream.cliff_time,
            stream.claimed_amount,
            stream.cancelled,
        )
    }

    /// Calculate withdrawable amount for a stream at given time
    #[external("utility")]
    unconstrained fn get_withdrawable(stream_id: Field, current_time: u64) -> pub u128 {
        let stream = self.storage.streams.at(stream_id).read();
        if stream.cancelled {
            // For cancelled streams, withdrawable is based on vested amount at cancellation
            // (total_amount was already adjusted to vested amount)
            stream.compute_withdrawable(current_time)
        } else {
            stream.compute_withdrawable(current_time)
        }
    }

    /// Calculate unvested amount for a stream (for cancel_stream)
    #[external("utility")]
    unconstrained fn get_unvested(stream_id: Field, current_time: u64) -> pub u128 {
        let stream = self.storage.streams.at(stream_id).read();
        stream.compute_unvested(current_time)
    }

    /// Check if a stream exists
    #[external("utility")]
    unconstrained fn stream_exists(stream_id: Field) -> pub bool {
        let stream = self.storage.streams.at(stream_id).read();
        !stream.sender.is_zero()
    }
}
