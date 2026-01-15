mod lib;
mod stream_note;

use aztec::macros::aztec;

/// Private Streaming Payments Contract
///
/// Enables salary streaming, token vesting, and subscription payments where:
/// - Amounts and schedules remain private
/// - Tokens unlock linearly over time with optional cliff
/// - Recipient can withdraw unlocked portion privately
/// - Sender can cancel stream and reclaim unvested tokens
///
/// Token Flow:
/// - create_stream: sender private balance -> contract public balance (escrow)
/// - withdraw: contract public balance -> recipient private balance
/// - cancel: contract public balance -> sender private balance (unvested portion)
#[aztec]
pub contract StreamingPayments {
    use crate::stream_note::StreamNote;

    use aztec::{
        macros::{functions::{external, initializer}, storage::storage},
        messages::message_delivery::MessageDelivery,
        oracle::random::random,
        protocol_types::{
            address::AztecAddress,
            hash::poseidon2_hash_with_separator,
            traits::ToField,
        },
        state_vars::{Map, Owned, PrivateMutable, PublicImmutable},
    };

    use dep::token::Token;

    /// Domain separator for stream ID generation
    global STREAM_ID_SEPARATOR: u32 = 1;

    #[storage]
    struct Storage<Context> {
        /// Token contract address for streaming payments
        token: PublicImmutable<AztecAddress, Context>,

        /// Stream notes stored by stream_id, owned by recipient
        streams: Map<Field, Owned<PrivateMutable<StreamNote, Context>, Context>, Context>,
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

        // Create the stream note for the recipient
        let stream_note = StreamNote::new(
            stream_id,
            sender,
            recipient,
            total_amount,
            start_time,
            end_time,
            cliff_time,
        );

        // Initialize the stream storage
        // The stream is stored under recipient's ownership
        self.storage.streams.at(stream_id).at(recipient).initialize(stream_note).deliver(
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );

        stream_id
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
        let recipient = self.context.msg_sender().unwrap();
        let this_contract = self.context.this_address();

        assert(amount > 0, "Amount must be positive");

        // Get current timestamp from anchor block
        let current_time =
            self.context.get_anchor_block_header().global_variables.timestamp as u64;

        // Replace the stream note with updated claimed amount
        self.storage.streams.at(stream_id).at(recipient).replace(|stream: StreamNote| {
            // Verify the caller is the recipient (owner of the note)
            assert(stream.get_owner() == recipient, "Not stream recipient");

            // Check cliff has passed
            assert(current_time >= stream.get_cliff_time(), "Cliff not reached");

            // Calculate withdrawable amount
            let withdrawable = stream.compute_withdrawable(current_time);
            assert(amount <= withdrawable, "Exceeds withdrawable amount");

            // Create updated note with new claimed amount
            let new_claimed = stream.get_claimed_amount() + amount;
            stream.with_claimed(new_claimed)
        }).deliver(MessageDelivery.CONSTRAINED_ONCHAIN);

        // Transfer tokens from contract's public balance to recipient's private balance
        // No authwit needed since contract is transferring from its own balance
        let token_address = self.storage.token.read();
        self.call(
            Token::at(token_address).transfer_public_to_private(
                this_contract,
                recipient,
                amount,
                0,
            ),
        );
    }

    // =========================================================================
    // Stream Cancellation
    // =========================================================================

    /// Cancel a stream and return unvested tokens to sender
    /// Vested but unclaimed tokens remain available for recipient to claim
    ///
    /// # Arguments
    /// * `stream_id` - ID of the stream to cancel
    /// * `recipient` - Address of the stream recipient (needed to locate the note)
    /// * `unvested_amount` - The unvested amount to return to sender (caller must calculate)
    ///
    /// Note: The caller must provide the correct unvested_amount. This is validated against
    /// the stream note data. This design avoids mutable captures in closures.
    #[external("private")]
    fn cancel_stream(stream_id: Field, recipient: AztecAddress, unvested_amount: u128) {
        let sender = self.context.msg_sender().unwrap();
        let this_contract = self.context.this_address();

        // Get current timestamp
        let current_time =
            self.context.get_anchor_block_header().global_variables.timestamp as u64;

        // Replace the stream note - mark it as cancelled by setting end_time to current_time
        // This effectively stops further vesting while preserving already vested amounts
        self.storage.streams.at(stream_id).at(recipient).replace(|stream: StreamNote| {
            // Verify caller is the sender (creator) of the stream
            assert(stream.get_sender() == sender, "Not stream sender");

            // Calculate amounts and validate the provided unvested_amount
            let vested = stream.compute_unlocked(current_time);
            let computed_unvested = stream.get_total_amount() - vested;
            assert(unvested_amount == computed_unvested, "Invalid unvested amount");

            // Create a "cancelled" stream note:
            // - end_time = current_time (no more vesting)
            // - total_amount = vested (only vested amount remains)
            StreamNote::new(
                stream.get_stream_id(),
                stream.get_sender(),
                stream.get_owner(), // recipient
                vested, // new total is just the vested amount
                stream.get_start_time(),
                current_time, // end time is now
                stream.get_cliff_time(),
            ).with_claimed(stream.get_claimed_amount())
        }).deliver(MessageDelivery.CONSTRAINED_ONCHAIN);

        // Transfer unvested tokens back to sender's private balance
        if unvested_amount > 0 {
            let token_address = self.storage.token.read();
            self.call(
                Token::at(token_address).transfer_public_to_private(
                    this_contract,
                    sender,
                    unvested_amount,
                    0,
                ),
            );
        }
    }

    // =========================================================================
    // Utility Functions (View)
    // =========================================================================

    /// Get the token contract address
    #[external("utility")]
    unconstrained fn get_token() -> pub AztecAddress {
        self.storage.token.read()
    }

    /// Get stream information (unconstrained view function)
    #[external("utility")]
    unconstrained fn get_stream_info(
        stream_id: Field,
        recipient: AztecAddress,
    ) -> pub (Field, AztecAddress, u128, u64, u64, u64, u128) {
        let stream = self.storage.streams.at(stream_id).at(recipient).view_note();
        (
            stream.get_stream_id(),
            stream.get_sender(),
            stream.get_total_amount(),
            stream.get_start_time(),
            stream.get_end_time(),
            stream.get_cliff_time(),
            stream.get_claimed_amount(),
        )
    }

    /// Calculate withdrawable amount for a stream at current time
    #[external("utility")]
    unconstrained fn get_withdrawable(
        stream_id: Field,
        recipient: AztecAddress,
        current_time: u64,
    ) -> pub u128 {
        let stream = self.storage.streams.at(stream_id).at(recipient).view_note();
        stream.compute_withdrawable(current_time)
    }

    /// Calculate unvested amount for a stream (for cancel_stream)
    #[external("utility")]
    unconstrained fn get_unvested(
        stream_id: Field,
        recipient: AztecAddress,
        current_time: u64,
    ) -> pub u128 {
        let stream = self.storage.streams.at(stream_id).at(recipient).view_note();
        let vested = stream.compute_unlocked(current_time);
        stream.get_total_amount() - vested
    }
}
