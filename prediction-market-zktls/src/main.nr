mod config;
mod price;

use aztec::macros::aztec;

/// Private prediction market with zkTLS resolution and real token collateral.
///
/// Uses a **complete-set model** for provable solvency:
/// - `mint_sets(n)`: deposit n collateral tokens, receive n YES + n NO shares
/// - `burn_sets(n)`: return n YES + n NO shares, receive n collateral tokens
/// - `redeem(n)`: after resolution, burn n winning shares, receive n collateral
///
/// Solvency invariant: total_collateral = total_yes = total_no (always).
/// After resolution, winning shares redeem 1:1 and losing shares are worthless.
/// Since winning_shares <= total_shares = total_collateral, always solvent.
///
/// Resolution uses Primus zkTLS attestations from CoinGecko's price API.
/// ECDSA verification in private, state update in public with expiry check.
#[aztec]
pub contract PredictionMarketZkTLS {
    use crate::config::NUM_ALLOWED_URLS;
    use crate::price::{parse_price_cents, MAX_PLAINTEXT_LEN};

    use att_verifier_lib::verify_attestation_hashing;
    use poseidon::poseidon2::Poseidon2;
    use token_contract::Token;

    use aztec::{
        macros::{functions::{external, initializer, only_self}, storage::storage},
        messages::message_delivery::MessageDelivery,
        protocol::address::AztecAddress,
        state_vars::{PublicMutable, PublicImmutable, Owned},
    };
    use balance_set::BalanceSet;

    // ---------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------

    global MAX_URL_LEN: u32 = 128;
    global NUM_RESPONSE_RESOLVE: u32 = 2;

    // Resolution must happen within 7 days of expiry (limits stale attestations)
    pub global RESOLUTION_WINDOW: u64 = 604800;

    // ---------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------

    #[storage]
    struct Storage<Context> {
        // Private share balances (note-based, only owner can read)
        yes_balances: Owned<BalanceSet<Context>, Context>,
        no_balances: Owned<BalanceSet<Context>, Context>,

        // Public state
        admin: PublicMutable<AztecAddress, Context>,
        total_sets: PublicMutable<u128, Context>,

        // Collateral token (set once via set_token)
        token: PublicImmutable<AztecAddress, Context>,

        // Market configuration (readable from private via historical proof)
        expiry: PublicImmutable<u64, Context>,
        price_threshold: PublicImmutable<u128, Context>,
        threshold_above: PublicImmutable<bool, Context>,
        allowed_url_hashes: PublicImmutable<[Field; NUM_ALLOWED_URLS], Context>,

        // Trusted Primus attester identity (Poseidon2 hash of public key bytes)
        trusted_attester_hash: PublicImmutable<Field, Context>,

        // Resolution (initialized once when market resolves)
        resolution_outcome: PublicImmutable<bool, Context>,
        resolution_price: PublicImmutable<u128, Context>,
    }

    // ---------------------------------------------------------------------------
    // Constructor + token setup
    // ---------------------------------------------------------------------------

    #[initializer]
    #[external("public")]
    fn constructor(
        admin: AztecAddress,
        expiry: u64,
        price_threshold: u128,
        threshold_above: bool,
        allowed_url_hashes: [Field; NUM_ALLOWED_URLS],
        attester_key_hash: Field,
    ) {
        assert(!admin.is_zero(), "INVALID_ADMIN");
        assert(attester_key_hash != 0, "INVALID_ATTESTER_HASH");

        self.storage.admin.write(admin);
        self.storage.total_sets.write(0);

        self.storage.expiry.initialize(expiry);
        self.storage.price_threshold.initialize(price_threshold);
        self.storage.threshold_above.initialize(threshold_above);
        self.storage.allowed_url_hashes.initialize(allowed_url_hashes);
        self.storage.trusted_attester_hash.initialize(attester_key_hash);
    }

    /// Set the collateral token address. Can only be called once, by the admin.
    /// Call this after deploying the Token contract.
    #[external("public")]
    fn set_token(token: AztecAddress) {
        assert(!token.is_zero(), "INVALID_TOKEN");
        assert(
            self.storage.admin.read().eq(self.msg_sender()),
            "ONLY_ADMIN",
        );
        // PublicImmutable::initialize fails if already set
        self.storage.token.initialize(token);
    }

    // ---------------------------------------------------------------------------
    // Private: complete-set operations (backed by real token collateral)
    // ---------------------------------------------------------------------------

    /// Mint complete sets: deposit collateral tokens, receive equal YES + NO shares.
    ///
    /// Requires an auth witness from the caller authorizing this contract to
    /// transfer `amount` of their private tokens via transfer_private_to_public.
    ///
    /// Solvency: each collateral token backs exactly 1 YES + 1 NO share.
    #[external("private")]
    fn mint_sets(amount: u128, collateral_nonce: Field) {
        assert(amount > 0, "ZERO_AMOUNT");

        let sender = self.msg_sender();
        let token = self.storage.token.read();

        // Transfer collateral from user's private balance to contract's public balance.
        // Requires auth witness from sender.
        self.call(Token::at(token).transfer_private_to_public(
            sender,
            self.context.this_address(),
            amount,
            collateral_nonce,
        ));

        // Create YES and NO shares for the user (private notes)
        self.storage.yes_balances.at(sender).add(amount)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
        self.storage.no_balances.at(sender).add(amount)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);

        // Track total sets outstanding
        self.enqueue_self._add_sets(amount);
    }

    #[only_self]
    #[external("public")]
    fn _add_sets(amount: u128) {
        let current = self.storage.total_sets.read();
        self.storage.total_sets.write(current + amount);
    }

    /// Burn complete sets: return equal YES + NO shares, receive collateral tokens.
    ///
    /// Works at any time (before or after resolution). Each complete set
    /// (1 YES + 1 NO) is always worth exactly 1 collateral token.
    #[external("private")]
    fn burn_sets(amount: u128) {
        assert(amount > 0, "ZERO_AMOUNT");

        let sender = self.msg_sender();
        let token = self.storage.token.read();

        // Burn equal YES and NO shares
        self.storage.yes_balances.at(sender).sub(amount)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
        self.storage.no_balances.at(sender).sub(amount)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);

        // Return collateral from contract's public balance to user's private balance.
        // transfer_public_to_private is a private function that enqueues public state changes.
        // No auth witness needed: from == this contract, nonce == 0.
        self.call(Token::at(token).transfer_public_to_private(
            self.context.this_address(),
            sender,
            amount,
            0,
        ));

        // Decrease total sets
        self.enqueue_self._sub_sets(amount);
    }

    #[only_self]
    #[external("public")]
    fn _sub_sets(amount: u128) {
        let current = self.storage.total_sets.read();
        self.storage.total_sets.write(current - amount);
    }

    // ---------------------------------------------------------------------------
    // Private: redeem winning shares after resolution
    // ---------------------------------------------------------------------------

    /// Redeem winning shares for collateral 1:1 after market resolution.
    ///
    /// Burns winning shares and transfers collateral tokens back to the caller.
    /// Fails if market is not yet resolved or caller has no winning shares.
    ///
    /// Privacy note: the recipient address is revealed in the public token
    /// transfer. Share holdings (YES vs NO) remain private.
    #[external("private")]
    fn redeem(amount: u128) {
        assert(amount > 0, "ZERO_AMOUNT");

        let sender = self.msg_sender();
        let token = self.storage.token.read();

        // Read resolution outcome (fails if uninitialized = not yet resolved)
        let outcome_is_yes = self.storage.resolution_outcome.read();

        // Burn winning shares only
        if outcome_is_yes {
            self.storage.yes_balances.at(sender).sub(amount)
                .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
        } else {
            self.storage.no_balances.at(sender).sub(amount)
                .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
        }

        // Return collateral
        self.call(Token::at(token).transfer_public_to_private(
            self.context.this_address(),
            sender,
            amount,
            0,
        ));

        // Decrease total sets
        self.enqueue_self._sub_sets(amount);
    }

    // ---------------------------------------------------------------------------
    // Private -> Public: zkTLS market resolution
    // ---------------------------------------------------------------------------

    /// Resolve the market using a Primus zkTLS attestation from CoinGecko.
    ///
    /// Anyone can call this after market expiry with a valid attestation.
    /// ECDSA verification runs in private (client-side proving).
    /// State update runs in public (_set_resolution checks expiry + resolution window).
    #[external("private")]
    fn resolve_market(
        public_key_x: [u8; 32],
        public_key_y: [u8; 32],
        hash: [u8; 32],
        signature: [u8; 64],
        request_urls: [BoundedVec<u8, MAX_URL_LEN>; 2],
        allowed_urls: [BoundedVec<u8, MAX_URL_LEN>; NUM_ALLOWED_URLS],
        data_hashes: [[u8; 32]; NUM_RESPONSE_RESOLVE],
        contents: [BoundedVec<u8, MAX_PLAINTEXT_LEN>; NUM_RESPONSE_RESOLVE],
    ) {
        // Verify zkTLS attestation (ECDSA signature + SHA256 content hashes)
        let url_hashes: [Field; 2] = verify_attestation_hashing(
            public_key_x,
            public_key_y,
            hash,
            signature,
            request_urls,
            allowed_urls,
            data_hashes,
            contents,
        );

        // Verify attester identity: Poseidon2(pubkey_x || pubkey_y) must match stored hash
        let mut key_hash_input: [Field; 64] = [0; 64];
        for i in 0..32 {
            key_hash_input[i] = public_key_x[i] as Field;
            key_hash_input[i + 32] = public_key_y[i] as Field;
        }
        let attester_hash = Poseidon2::hash(key_hash_input, 64);
        let trusted_hash = self.storage.trusted_attester_hash.read();
        assert(attester_hash == trusted_hash, "UNTRUSTED_ATTESTER");

        // Check URL hashes against allowed list (historical read from private)
        let stored_hashes = self.storage.allowed_url_hashes.read();
        for i in 0..2 {
            let mut found = false;
            for j in 0..NUM_ALLOWED_URLS {
                if url_hashes[i] == stored_hashes[j] {
                    found = true;
                }
            }
            assert(found, "URL_NOT_ALLOWED");
        }

        // Both response resolves extract the same price -- verify they match
        assert(
            contents[0].storage() == contents[1].storage(),
            "PRICE_MISMATCH",
        );

        // Parse ASCII decimal price into integer cents
        let resolved_price = parse_price_cents(contents[0]);

        // Determine outcome (historical reads from private)
        let above = self.storage.threshold_above.read();
        let threshold = self.storage.price_threshold.read();
        let outcome_is_yes = if above {
            resolved_price >= threshold
        } else {
            resolved_price < threshold
        };

        // Enqueue public function to check expiry window and set resolution
        self.enqueue_self._set_resolution(outcome_is_yes, resolved_price);
    }

    /// Set resolution state in public context.
    /// Checks expiry and resolution window, then initializes resolution immutables.
    #[only_self]
    #[external("public")]
    fn _set_resolution(outcome_is_yes: bool, resolved_price: u128) {
        let market_expiry = self.storage.expiry.read();
        let now = self.context.timestamp();

        // Market must be past expiry
        assert(now >= market_expiry, "MARKET_NOT_EXPIRED");

        // Must resolve within RESOLUTION_WINDOW of expiry (limits stale attestations)
        assert(now <= market_expiry + RESOLUTION_WINDOW, "RESOLUTION_WINDOW_EXPIRED");

        // Initialize resolution -- fails on second call (prevents double-resolution)
        self.storage.resolution_outcome.initialize(outcome_is_yes);
        self.storage.resolution_price.initialize(resolved_price);
    }

    // ---------------------------------------------------------------------------
    // Utility views
    // ---------------------------------------------------------------------------

    #[external("utility")]
    unconstrained fn get_yes_balance(user: AztecAddress) -> pub u128 {
        self.storage.yes_balances.at(user).balance_of()
    }

    #[external("utility")]
    unconstrained fn get_no_balance(user: AztecAddress) -> pub u128 {
        self.storage.no_balances.at(user).balance_of()
    }

    #[external("utility")]
    unconstrained fn get_total_sets() -> pub u128 {
        self.storage.total_sets.read()
    }

    #[external("utility")]
    unconstrained fn get_admin() -> pub AztecAddress {
        self.storage.admin.read()
    }

    #[external("utility")]
    unconstrained fn get_token() -> pub AztecAddress {
        self.storage.token.read()
    }

    #[external("utility")]
    unconstrained fn get_expiry() -> pub u64 {
        self.storage.expiry.read()
    }

    #[external("utility")]
    unconstrained fn get_price_threshold() -> pub u128 {
        self.storage.price_threshold.read()
    }

    #[external("utility")]
    unconstrained fn get_threshold_above() -> pub bool {
        self.storage.threshold_above.read()
    }

    #[external("utility")]
    unconstrained fn is_resolved() -> pub bool {
        self.storage.resolution_outcome.is_initialized()
    }

    #[external("utility")]
    unconstrained fn get_resolution_outcome() -> pub bool {
        self.storage.resolution_outcome.read()
    }

    #[external("utility")]
    unconstrained fn get_resolution_price() -> pub u128 {
        self.storage.resolution_price.read()
    }
}
