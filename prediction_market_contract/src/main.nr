mod lib;

use dep::aztec::macros::aztec;

/// Binary prediction market with full identity privacy using CSMM pricing.
/// All balances are private. Public function only sees trade amounts, not who traded.
#[aztec]
pub contract PredictionMarket {
    use crate::lib::{calculate_shares_out, calculate_new_price, calculate_price_impact};
    use dep::aztec::{
        macros::{functions::{external, initializer, internal}, storage::storage},
        messages::message_delivery::MessageDelivery,
        note::{
            constants::MAX_NOTES_PER_PAGE,
            note_getter_options::NoteGetterOptions,
            note_viewer_options::NoteViewerOptions,
        },
        protocol_types::{address::AztecAddress, storage::map::derive_storage_slot_in_map},
        state_vars::{PublicMutable, Map, PrivateSet},
    };
    use dep::uint_note::uint_note::{UintNote, PartialUintNote};

    #[storage]
    struct Storage<Context> {
        collateral_balances: Map<AztecAddress, PrivateSet<UintNote, Context>, Context>,
        yes_supply: PublicMutable<u128, Context>,
        no_supply: PublicMutable<u128, Context>,
        total_liquidity: PublicMutable<u128, Context>,
        admin: PublicMutable<AztecAddress, Context>,
        yes_balances: Map<AztecAddress, PrivateSet<UintNote, Context>, Context>,
        no_balances: Map<AztecAddress, PrivateSet<UintNote, Context>, Context>,
    }

    pub global PRICE_PRECISION: u128 = 1_000_000;
    pub global MINIMUM_LIQUIDITY: u128 = 1000;

    #[initializer]
    #[external("public")]
    fn constructor(admin: AztecAddress, initial_liquidity: u128) {
        assert(initial_liquidity >= MINIMUM_LIQUIDITY, "INSUFFICIENT_INITIAL_LIQUIDITY");
        assert(!admin.is_zero(), "INVALID_ADMIN");

        storage.admin.write(admin);
        let half = initial_liquidity / 2;
        storage.yes_supply.write(half);
        storage.no_supply.write(half);
        storage.total_liquidity.write(initial_liquidity);
    }

    /// Deposit collateral privately. Creates a private note for the sender.
    #[external("private")]
    fn deposit(amount: u128) {
        assert(amount > 0, "ZERO_AMOUNT");
        let sender = context.msg_sender().unwrap();
        let note = UintNote::new(amount, sender);
        storage.collateral_balances.at(sender).insert(note).emit(sender, MessageDelivery.UNCONSTRAINED_ONCHAIN);
    }

    /// Withdraw collateral privately. Consumes notes and returns change.
    #[external("private")]
    fn withdraw(amount: u128) {
        assert(amount > 0, "ZERO_AMOUNT");
        let sender = context.msg_sender().unwrap();

        let options = NoteGetterOptions::new();
        let notes: BoundedVec<UintNote, 16> = storage.collateral_balances.at(sender).pop_notes(options);

        let mut total: u128 = 0;
        for i in 0..16 {
            if i < notes.len() {
                total += notes.get_unchecked(i).get_value();
            }
        }

        assert(total >= amount, "INSUFFICIENT_COLLATERAL_BALANCE");

        let change = total - amount;
        if change > 0 {
            let change_note = UintNote::new(change, sender);
            storage.collateral_balances.at(sender).insert(change_note).emit(sender, MessageDelivery.UNCONSTRAINED_ONCHAIN);
        }
    }

    /// Buy YES or NO shares with full identity privacy.
    /// Uses partial notes so shares arrive in single transaction.
    #[external("private")]
    fn buy_outcome(is_yes: bool, collateral_amount: u128, min_shares_out: u128) {
        assert(collateral_amount > 0, "INSUFFICIENT_COLLATERAL");

        let sender = context.msg_sender().unwrap();
        let contract_address = context.this_address();

        // Consume collateral notes
        let options = NoteGetterOptions::new();
        let notes: BoundedVec<UintNote, 16> = storage.collateral_balances.at(sender).pop_notes(options);

        let mut total: u128 = 0;
        for i in 0..16 {
            if i < notes.len() {
                total += notes.get_unchecked(i).get_value();
            }
        }

        assert(total >= collateral_amount, "INSUFFICIENT_COLLATERAL_BALANCE");

        // Return change
        let change = total - collateral_amount;
        if change > 0 {
            let change_note = UintNote::new(change, sender);
            storage.collateral_balances.at(sender).insert(change_note).emit(sender, MessageDelivery.UNCONSTRAINED_ONCHAIN);
        }

        // Create partial note for shares
        // Storage slots are required for deriving partial note locations.
        // This is because the partial note needs to be manually placed at that slot because we cannot use PrivateSet::insert().
        // We cannot use PrivateSet::insert() because the note does not exist yet, as it is not fully created in private.

        let base_slot = if is_yes { PredictionMarket::storage_layout().yes_balances.slot } else { PredictionMarket::storage_layout().no_balances.slot };
        let storage_slot: Field = derive_storage_slot_in_map(base_slot, sender);
        let partial_note = UintNote::partial(sender, storage_slot, &mut context, sender, contract_address);

        // Enqueue public call - sender address is NOT passed, preserving identity privacy
        PredictionMarket::at(contract_address)
            ._process_buy(is_yes, collateral_amount, min_shares_out, partial_note)
            .enqueue(&mut context);
    }

    /// Process buy in public context. Does not know who is buying.
    #[internal]
    #[external("public")]
    fn _process_buy(is_yes: bool, collateral_amount: u128, min_shares_out: u128, partial_note: PartialUintNote) {
        let yes_supply = storage.yes_supply.read();
        let no_supply = storage.no_supply.read();
        let liquidity = storage.total_liquidity.read();

        let (shares_out, new_supply) = calculate_shares_out(
            collateral_amount,
            if is_yes { yes_supply } else { no_supply },
            liquidity,
        );

        assert(shares_out >= min_shares_out, "SLIPPAGE_EXCEEDED");

        if is_yes {
            storage.yes_supply.write(new_supply);
        } else {
            storage.no_supply.write(new_supply);
        }
        storage.total_liquidity.write(liquidity + collateral_amount);

        partial_note.complete(&mut context, context.this_address(), shares_out);
    }

    /// Get current price for YES or NO (returns value with PRICE_PRECISION decimals).
    #[external("utility")]
    unconstrained fn get_price(is_yes: bool) -> u128 {
        let yes_supply = storage.yes_supply.read();
        let no_supply = storage.no_supply.read();
        calculate_new_price(if is_yes { yes_supply } else { no_supply }, yes_supply + no_supply)
    }

    /// Get market state: (yes_supply, no_supply, total_liquidity).
    #[external("utility")]
    unconstrained fn get_market_state() -> (u128, u128, u128) {
        (storage.yes_supply.read(), storage.no_supply.read(), storage.total_liquidity.read())
    }

    /// Quote shares out for a given collateral amount.
    #[external("utility")]
    unconstrained fn quote_buy(is_yes: bool, collateral_amount: u128) -> u128 {
        let yes_supply = storage.yes_supply.read();
        let no_supply = storage.no_supply.read();
        let liquidity = storage.total_liquidity.read();
        let (shares_out, _) = calculate_shares_out(
            collateral_amount,
            if is_yes { yes_supply } else { no_supply },
            liquidity,
        );
        shares_out
    }

    /// Quote price impact for a purchase.
    /// Returns: (price_before, price_after, impact_percentage)
    /// All values use PRICE_PRECISION (1_000_000) as the decimal base.
    #[external("utility")]
    unconstrained fn quote_price_impact(is_yes: bool, collateral_amount: u128) -> (u128, u128, u128) {
        let yes_supply = storage.yes_supply.read();
        let no_supply = storage.no_supply.read();
        let liquidity = storage.total_liquidity.read();
        calculate_price_impact(
            collateral_amount,
            if is_yes { yes_supply } else { no_supply },
            liquidity,
        )
    }

    /// Get user's private collateral balance.
    #[external("utility")]
    unconstrained fn get_collateral_balance(user: AztecAddress) -> u128 {
        let notes: BoundedVec<UintNote, MAX_NOTES_PER_PAGE> = storage.collateral_balances.at(user).view_notes(NoteViewerOptions::new());
        let mut sum: u128 = 0;
        for i in 0..notes.len() {
            sum += notes.get_unchecked(i).get_value();
        }
        sum
    }

    /// Get user's private YES token balance.
    #[external("utility")]
    unconstrained fn get_yes_balance(user: AztecAddress) -> u128 {
        let notes: BoundedVec<UintNote, MAX_NOTES_PER_PAGE> = storage.yes_balances.at(user).view_notes(NoteViewerOptions::new());
        let mut sum: u128 = 0;
        for i in 0..notes.len() {
            sum += notes.get_unchecked(i).get_value();
        }
        sum
    }

    /// Get user's private NO token balance.
    #[external("utility")]
    unconstrained fn get_no_balance(user: AztecAddress) -> u128 {
        let notes: BoundedVec<UintNote, MAX_NOTES_PER_PAGE> = storage.no_balances.at(user).view_notes(NoteViewerOptions::new());
        let mut sum: u128 = 0;
        for i in 0..notes.len() {
            sum += notes.get_unchecked(i).get_value();
        }
        sum
    }

    #[external("utility")]
    unconstrained fn get_admin() -> AztecAddress {
        storage.admin.read()
    }
}
