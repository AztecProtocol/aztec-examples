mod lib;

use aztec::macros::aztec;

/// Binary prediction market with full identity privacy using CSMM pricing.
/// All balances are private. Public function only sees trade amounts, not who traded.
#[aztec]
pub contract PredictionMarket {
    use crate::lib::{calculate_shares_out, calculate_new_price, calculate_price_impact};
    use aztec::{
        macros::{functions::{external, initializer, only_self}, storage::storage},
        messages::message_delivery::MessageDelivery,
        protocol_types::address::AztecAddress,
        state_vars::{PublicMutable, Owned, state_variable::StateVariable},
    };
    use dep::balance_set::balance_set::BalanceSet;
    use dep::uint_note::uint_note::{UintNote, PartialUintNote};

    #[storage]
    struct Storage<Context> {
        collateral_balances: Owned<BalanceSet<Context>, Context>,
        yes_supply: PublicMutable<u128, Context>,
        no_supply: PublicMutable<u128, Context>,
        total_liquidity: PublicMutable<u128, Context>,
        admin: PublicMutable<AztecAddress, Context>,
        yes_balances: Owned<BalanceSet<Context>, Context>,
        no_balances: Owned<BalanceSet<Context>, Context>,
    }

    pub global PRICE_PRECISION: u128 = 1_000_000;
    pub global MINIMUM_LIQUIDITY: u128 = 1000;

    #[initializer]
    #[external("public")]
    fn constructor(admin: AztecAddress, initial_liquidity: u128) {
        assert(initial_liquidity >= MINIMUM_LIQUIDITY, "INSUFFICIENT_INITIAL_LIQUIDITY");
        assert(!admin.is_zero(), "INVALID_ADMIN");

        self.storage.admin.write(admin);
        let half = initial_liquidity / 2;
        self.storage.yes_supply.write(half);
        self.storage.no_supply.write(half);
        self.storage.total_liquidity.write(initial_liquidity);
    }

    /// Deposit collateral privately. Creates a private note for the sender.
    #[external("private")]
    fn deposit(amount: u128) {
        assert(amount > 0, "ZERO_AMOUNT");
        let sender = self.context.msg_sender().unwrap();
        self.storage.collateral_balances.at(sender).add(amount)
            .deliver(MessageDelivery.UNCONSTRAINED_ONCHAIN);
    }

    /// Withdraw collateral privately. Consumes notes and returns change.
    #[external("private")]
    fn withdraw(amount: u128) {
        assert(amount > 0, "ZERO_AMOUNT");
        let sender = self.context.msg_sender().unwrap();
        self.storage.collateral_balances.at(sender).sub(amount)
            .deliver(MessageDelivery.UNCONSTRAINED_ONCHAIN);
    }

    /// Buy YES or NO shares with full identity privacy.
    /// Uses partial notes so shares arrive in single transaction.
    #[external("private")]
    fn buy_outcome(is_yes: bool, collateral_amount: u128, min_shares_out: u128) {
        assert(collateral_amount > 0, "INSUFFICIENT_COLLATERAL");

        let sender = self.context.msg_sender().unwrap();
        let contract_address = self.context.this_address();

        // Consume collateral - sub handles note consumption and change
        self.storage.collateral_balances.at(sender).sub(collateral_amount)
            .deliver(MessageDelivery.UNCONSTRAINED_ONCHAIN);

        // Create partial note for shares
        // Use get_storage_slot() from the Owned wrapper - it handles owner derivation internally
        let storage_slot = if is_yes {
            self.storage.yes_balances.get_storage_slot()
        } else {
            self.storage.no_balances.get_storage_slot()
        };
        let partial_note = UintNote::partial(sender, storage_slot, self.context, sender, contract_address);

        // Enqueue public call - sender address is NOT passed, preserving identity privacy
        self.enqueue_self._process_buy(is_yes, collateral_amount, min_shares_out, partial_note);
    }

    /// Process buy in public context. Does not know who is buying.
    #[only_self]
    #[external("public")]
    fn _process_buy(is_yes: bool, collateral_amount: u128, min_shares_out: u128, partial_note: PartialUintNote) {
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

        partial_note.complete(self.context, self.context.this_address(), shares_out);
    }

    /// Get current price for YES or NO (returns value with PRICE_PRECISION decimals).
    #[external("utility")]
    unconstrained fn get_price(is_yes: bool) -> pub u128 {
        let yes_supply = self.storage.yes_supply.read();
        let no_supply = self.storage.no_supply.read();
        calculate_new_price(if is_yes { yes_supply } else { no_supply }, yes_supply + no_supply)
    }

    /// Get market state: (yes_supply, no_supply, total_liquidity).
    #[external("utility")]
    unconstrained fn get_market_state() -> pub (u128, u128, u128) {
        (self.storage.yes_supply.read(), self.storage.no_supply.read(), self.storage.total_liquidity.read())
    }

    /// Quote shares out for a given collateral amount.
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

    /// Quote price impact for a purchase.
    /// Returns: (price_before, price_after, impact_percentage)
    #[external("utility")]
    unconstrained fn quote_price_impact(is_yes: bool, collateral_amount: u128) -> pub (u128, u128, u128) {
        let yes_supply = self.storage.yes_supply.read();
        let no_supply = self.storage.no_supply.read();
        let liquidity = self.storage.total_liquidity.read();
        calculate_price_impact(
            collateral_amount,
            if is_yes { yes_supply } else { no_supply },
            liquidity,
        )
    }

    /// Get user's private collateral balance (unconstrained view).
    #[external("utility")]
    unconstrained fn get_collateral_balance(user: AztecAddress) -> pub u128 {
        self.storage.collateral_balances.at(user).balance_of()
    }

    /// Get user's private YES token balance (unconstrained view).
    #[external("utility")]
    unconstrained fn get_yes_balance(user: AztecAddress) -> pub u128 {
        self.storage.yes_balances.at(user).balance_of()
    }

    /// Get user's private NO token balance (unconstrained view).
    #[external("utility")]
    unconstrained fn get_no_balance(user: AztecAddress) -> pub u128 {
        self.storage.no_balances.at(user).balance_of()
    }

    #[external("utility")]
    unconstrained fn get_admin() -> pub AztecAddress {
        self.storage.admin.read()
    }
}
