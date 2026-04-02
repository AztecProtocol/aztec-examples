mod config;
mod lib;
mod price;

use aztec::macros::aztec;

/// Private prediction market with zkTLS resolution.
///
/// Binary outcome market ("Will BTC be above $X by date Y?") where:
/// - Bets are fully private (no one sees who bet what)
/// - Resolution uses Primus zkTLS attestations from CoinGecko's price API
/// - Settlement is private (winners redeem shares for collateral)
///
/// Architecture:
/// - CSMM (Constant Sum Market Maker) for pricing
/// - Partial notes for single-tx private betting (identity hidden from public)
/// - PublicImmutable for one-shot resolution (prevents double-resolve)
/// - PublicImmutable config readable from private context for redemption
#[aztec]
pub contract PredictionMarketZkTLS {
    use crate::config::NUM_ALLOWED_URLS;
    use crate::lib::{calculate_shares_out, calculate_new_price, calculate_price_impact};
    use crate::price::{parse_price_cents, MAX_PLAINTEXT_LEN};

    use att_verifier_lib::verify_attestation_hashing;

    use aztec::{
        macros::{functions::{external, initializer, only_self}, storage::storage},
        messages::message_delivery::MessageDelivery,
        protocol::address::AztecAddress,
        state_vars::{PublicMutable, PublicImmutable, Owned, StateVariable},
    };
    use balance_set::BalanceSet;
    use uint_note::{UintNote, PartialUintNote};

    // ---------------------------------------------------------------------------
    // Constants -- must match attestation parsing configuration
    // ---------------------------------------------------------------------------

    global MAX_URL_LEN: u32 = 128;
    global NUM_RESPONSE_RESOLVE: u32 = 2;

    pub global PRICE_PRECISION: u128 = 1_000_000;
    pub global MINIMUM_LIQUIDITY: u128 = 1000;

    // ---------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------

    #[storage]
    struct Storage<Context> {
        // Private balances (note-based, only owner can read)
        collateral_balances: Owned<BalanceSet<Context>, Context>,
        yes_balances: Owned<BalanceSet<Context>, Context>,
        no_balances: Owned<BalanceSet<Context>, Context>,

        // Public AMM state
        yes_supply: PublicMutable<u128, Context>,
        no_supply: PublicMutable<u128, Context>,
        total_liquidity: PublicMutable<u128, Context>,
        admin: PublicMutable<AztecAddress, Context>,

        // Market configuration (readable from private via historical proof)
        expiry: PublicImmutable<u64, Context>,
        price_threshold: PublicImmutable<u128, Context>,
        threshold_above: PublicImmutable<bool, Context>,
        allowed_url_hashes: PublicImmutable<[Field; NUM_ALLOWED_URLS], Context>,

        // Resolution (initialized once when market resolves)
        resolution_outcome: PublicImmutable<bool, Context>,
        resolution_price: PublicImmutable<u128, Context>,
    }

    // ---------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------

    #[initializer]
    #[external("public")]
    fn constructor(
        admin: AztecAddress,
        initial_liquidity: u128,
        expiry: u64,
        price_threshold: u128,
        threshold_above: bool,
        allowed_url_hashes: [Field; NUM_ALLOWED_URLS],
    ) {
        assert(initial_liquidity >= MINIMUM_LIQUIDITY, "INSUFFICIENT_INITIAL_LIQUIDITY");
        assert(!admin.is_zero(), "INVALID_ADMIN");

        self.storage.admin.write(admin);
        self.storage.yes_supply.write(initial_liquidity / 2);
        self.storage.no_supply.write(initial_liquidity / 2);
        self.storage.total_liquidity.write(initial_liquidity);

        self.storage.expiry.initialize(expiry);
        self.storage.price_threshold.initialize(price_threshold);
        self.storage.threshold_above.initialize(threshold_above);
        self.storage.allowed_url_hashes.initialize(allowed_url_hashes);
    }

    // ---------------------------------------------------------------------------
    // Private: deposit / withdraw collateral
    // ---------------------------------------------------------------------------

    /// Deposit collateral privately. Creates a private note for the sender.
    #[external("private")]
    fn deposit(amount: u128) {
        assert(amount > 0, "ZERO_AMOUNT");
        self.storage.collateral_balances.at(self.msg_sender()).add(amount)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
    }

    /// Withdraw collateral privately. Consumes notes and returns change.
    #[external("private")]
    fn withdraw(amount: u128) {
        assert(amount > 0, "ZERO_AMOUNT");
        self.storage.collateral_balances.at(self.msg_sender()).sub(amount)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
    }

    // ---------------------------------------------------------------------------
    // Private -> Public: buy outcome shares
    // ---------------------------------------------------------------------------

    /// Buy YES or NO shares with full identity privacy.
    /// Uses partial notes so shares arrive in a single transaction.
    /// The public _process_buy function does NOT receive the sender address.
    #[external("private")]
    fn buy_outcome(is_yes: bool, collateral_amount: u128, min_shares_out: u128) {
        assert(collateral_amount > 0, "INSUFFICIENT_COLLATERAL");

        let sender = self.msg_sender();

        // Consume collateral privately
        self.storage.collateral_balances.at(sender).sub(collateral_amount)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);

        // Create partial note for shares (owner hidden from public function)
        let storage_slot = if is_yes {
            self.storage.yes_balances.get_storage_slot()
        } else {
            self.storage.no_balances.get_storage_slot()
        };
        let partial_note = UintNote::partial(sender, self.context, sender, self.address);

        // Enqueue public call -- sender address is NOT passed
        self.enqueue_self._process_buy(
            is_yes,
            collateral_amount,
            min_shares_out,
            partial_note,
            storage_slot,
        );
    }

    /// Process buy in public context. Does not know who is buying.
    #[only_self]
    #[external("public")]
    fn _process_buy(
        is_yes: bool,
        collateral_amount: u128,
        min_shares_out: u128,
        partial_note: PartialUintNote,
        storage_slot: Field,
    ) {
        // Guard: market must not be resolved
        assert(!self.storage.resolution_outcome.is_initialized(), "MARKET_RESOLVED");

        // Guard: market must not be expired
        let market_expiry = self.storage.expiry.read();
        assert(self.context.timestamp() < market_expiry, "MARKET_EXPIRED");

        let yes_supply = self.storage.yes_supply.read();
        let no_supply = self.storage.no_supply.read();
        let liquidity = self.storage.total_liquidity.read();

        let (shares_out, new_supply) = calculate_shares_out(
            collateral_amount,
            if is_yes { yes_supply } else { no_supply },
            liquidity,
        );

        assert(shares_out >= min_shares_out, "SLIPPAGE_EXCEEDED");

        if is_yes {
            self.storage.yes_supply.write(new_supply);
        } else {
            self.storage.no_supply.write(new_supply);
        }
        self.storage.total_liquidity.write(liquidity + collateral_amount);

        partial_note.complete(
            self.context,
            self.context.this_address(),
            storage_slot,
            shares_out,
        );
    }

    // ---------------------------------------------------------------------------
    // Private -> Public: zkTLS market resolution
    // ---------------------------------------------------------------------------

    /// Resolve the market using a Primus zkTLS attestation from CoinGecko.
    ///
    /// Anyone can call this after market expiry with a valid attestation.
    /// The attestation proves a BTC/USD price was fetched from CoinGecko.
    /// The contract compares the price against the threshold to determine outcome.
    ///
    /// ECDSA verification runs in private (client-side proving).
    /// State update runs in public (_set_resolution, which checks expiry).
    /// Double-resolution prevention: PublicImmutable::initialize fails on second call.
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

        // Determine outcome based on threshold direction (historical reads from private)
        let above = self.storage.threshold_above.read();
        let threshold = self.storage.price_threshold.read();
        let outcome_is_yes = if above {
            resolved_price >= threshold
        } else {
            resolved_price < threshold
        };

        // Enqueue public function to check expiry and set resolution
        self.enqueue_self._set_resolution(outcome_is_yes, resolved_price);
    }

    /// Set resolution state in public context.
    /// Checks expiry (timestamp only available in public) and initializes
    /// resolution immutables (prevents double-resolution).
    #[only_self]
    #[external("public")]
    fn _set_resolution(outcome_is_yes: bool, resolved_price: u128) {
        // Market must be past expiry (timestamp only available in public context)
        let market_expiry = self.storage.expiry.read();
        assert(self.context.timestamp() >= market_expiry, "MARKET_NOT_EXPIRED");

        // Initialize resolution -- fails on second call (prevents double-resolution)
        self.storage.resolution_outcome.initialize(outcome_is_yes);
        self.storage.resolution_price.initialize(resolved_price);
    }

    // ---------------------------------------------------------------------------
    // Private: redeem winning shares for collateral
    // ---------------------------------------------------------------------------

    /// Redeem winning shares for collateral 1:1 after market resolution.
    ///
    /// Reads the resolution outcome from PublicImmutable (historical proof).
    /// Burns winning shares and credits collateral -- all via private notes.
    /// Fails if market is not yet resolved or if caller has no winning shares.
    #[external("private")]
    fn redeem(amount: u128) {
        assert(amount > 0, "ZERO_AMOUNT");

        let sender = self.msg_sender();

        // Read resolution (fails if not yet resolved -- uninitialized PublicImmutable)
        let outcome_is_yes = self.storage.resolution_outcome.read();

        // Burn winning shares
        if outcome_is_yes {
            self.storage.yes_balances.at(sender).sub(amount)
                .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
        } else {
            self.storage.no_balances.at(sender).sub(amount)
                .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
        }

        // Credit collateral 1:1
        self.storage.collateral_balances.at(sender).add(amount)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
    }

    // ---------------------------------------------------------------------------
    // Utility views
    // ---------------------------------------------------------------------------

    #[external("utility")]
    unconstrained fn get_price(is_yes: bool) -> pub u128 {
        let yes_supply = self.storage.yes_supply.read();
        let no_supply = self.storage.no_supply.read();
        calculate_new_price(
            if is_yes { yes_supply } else { no_supply },
            yes_supply + no_supply,
        )
    }

    #[external("utility")]
    unconstrained fn get_market_state() -> pub (u128, u128, u128) {
        (
            self.storage.yes_supply.read(),
            self.storage.no_supply.read(),
            self.storage.total_liquidity.read(),
        )
    }

    #[external("utility")]
    unconstrained fn quote_buy(is_yes: bool, collateral_amount: u128) -> pub u128 {
        let yes_supply = self.storage.yes_supply.read();
        let no_supply = self.storage.no_supply.read();
        let liquidity = self.storage.total_liquidity.read();
        let (shares_out, _) = calculate_shares_out(
            collateral_amount,
            if is_yes { yes_supply } else { no_supply },
            liquidity,
        );
        shares_out
    }

    #[external("utility")]
    unconstrained fn quote_price_impact(
        is_yes: bool,
        collateral_amount: u128,
    ) -> pub (u128, u128, u128) {
        let yes_supply = self.storage.yes_supply.read();
        let no_supply = self.storage.no_supply.read();
        let liquidity = self.storage.total_liquidity.read();
        calculate_price_impact(
            collateral_amount,
            if is_yes { yes_supply } else { no_supply },
            liquidity,
        )
    }

    #[external("utility")]
    unconstrained fn get_collateral_balance(user: AztecAddress) -> pub u128 {
        self.storage.collateral_balances.at(user).balance_of()
    }

    #[external("utility")]
    unconstrained fn get_yes_balance(user: AztecAddress) -> pub u128 {
        self.storage.yes_balances.at(user).balance_of()
    }

    #[external("utility")]
    unconstrained fn get_no_balance(user: AztecAddress) -> pub u128 {
        self.storage.no_balances.at(user).balance_of()
    }

    #[external("utility")]
    unconstrained fn get_admin() -> pub AztecAddress {
        self.storage.admin.read()
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
