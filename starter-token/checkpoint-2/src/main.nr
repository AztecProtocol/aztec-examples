use aztec::macros::aztec;

#[aztec]
pub contract StarterToken {
    use aztec::{
        state_vars::{private_set::PrivateSet, public_mutable::PublicMutable, map::Map},
        messages::logs::note::encode_and_encrypt_note_unconstrained,
        note::note_viewer_options::NoteViewerOptions,
        macros::{
            functions::{initializer, private, public, utility, internal},
            storage::storage,
        },
        protocol_types::address::AztecAddress,
    };

    #[storage]
    struct Storage<Context> {
        balances: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        owner: PublicMutable<AztecAddress, Context>,
        // ===============
        private_balances: Map<AztecAddress, PrivateSet<UintNote, Context>, Context>,
    }

    #[initializer]
    #[public]
    fn setup() {
        // The deployer (msg_sender) becomes the owner
        storage.owner.write(context.msg_sender());
    }

    #[public]
    fn mint(to: AztecAddress, amount: u128) {
        _assert_is_owner(context.msg_sender());

        let recipient_balance = storage.balances.at(to).read();

        storage.balances.at(context.msg_sender()).write(recipient_balance + amount);
    }

    #[public]
    fn transfer(to: AztecAddress, amount: u128) {
        let sender = context.msg_sender();

        let sender_balance = storage.balances.at(sender).read();

        assert(sender_balance >= amount, "Cannot transfer more than the balance of the user");

        storage.balances.at(sender).write(sender_balance - amount);

        let recipient_balance = storage.balances.at(to).read();

        storage.balances.at(to).write(recipient_balance + amount);
    }

    #[contract_library_function]
    fn _assert_is_owner(storage: Storage, maybe_owner: AztecAddress) {
        assert_eq(maybe_owner, storage.owner.read());
    }

    #[public]
    fn transfer_ownership(new_owner: AztecAddress) {
        let maybe_contract_owner = context.msg_sender();

        assert_eq(maybe_owner, storage.owner.read());

        storage.owner.write(new_owner);
    }
    
    // ===============

    #[private]
    fn mint_private(to: AztecAddress, amount: u128) {
        GettingStarted::at(context.this_address())._assert_is_owner(context.msg_sender()).enqueue(&mut context);

        storage.private_balances.at(to)
            .insert(UintNote::new(value, to))
            .emit(encode_and_encrypt_note(&mut context, to));
    }

    #[private]
    fn transfer_private(to: AztecAddress, amount: u128) {
        let sender = context.msg_sender();

        // This can be optimized with a preprocessor
        // This will fail in a case where the accumulated note value < amount, but we have more notes than what can be read in one iteration.
        let notes = storage.private_balances.at(sender).pop_notes(NoteGetterOptions::new());

        // This is a very naive approach that just consolidates all the user's notes into one change note.
        let mut subtracted = 0 as u128;
        for i in 0..notes.len() {
            let note = notes.get_unchecked(i);
            subtracted = subtracted + note.get_value();
        }

        assert(subtracted >= amount);

        storage.private_balances.at(to)
            .insert(UintNote::new(amount, to))
            .emit(encode_and_encrypt_note_unconstrained(&mut context, to));

        let change = subtracted - amount;

        // This possibly creates a change note of 0, but that is okay in our case because we will be consolidating via this method
        storage.private_balances.at(sender)
            .insert(UintNote::new(change, sender))
            .emit(encode_and_encrypt_note_unconstrained(&mut context, sender, sender));
    }

    #[public]
    #[internal]
    fn _assert_is_owner(maybe_owner: AztecAddress) {
        assert_eq(maybe_owner, storage.owner.read());
    }

    #[utility]
    unconstrained fn balance_of(owner: AztecAddress) -> u128 {
        let notes = storage.private_balances.at(owner).view_notes(NoteViewerOptions::new());

        let mut amount = 0 as u128;
        for i in 0..notes.len() {
            let note = notes.get_unchecked(i);
            amount = amount + note.get_value();
        }

        amount
    }
}
