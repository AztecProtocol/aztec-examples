use aztec::macros::aztec;

#[aztec]
pub contract GettingStarted {
    use aztec::{
        state_vars::{private_mutable::PrivateMutable, private_set::PrivateSet, public_mutable::PublicMutable, map::Map},
        messages::logs::note::encode_and_encrypt_note_unconstrained,
        note::{constants::MAX_NOTES_PER_PAGE, note_viewer_options::NoteViewerOptions},

        macros::{
            functions::{initializer, private, public, utility, internal},
            storage::storage,
        },
        protocol_types::{
            address::AztecAddress,
        },
    };

    use uint_note::uint_note::UintNote;

    #[storage]
    struct Storage<Context> {
        contract_private_state: PrivateMutable<UintNote, Context>,
        user_private_state: Map<AztecAddress, PrivateSet<UintNote, Context>, Context>,
        contract_public_state: PublicMutable<u128, Context>,
        user_public_state: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        owner: PublicMutable<AztecAddress, Context>,
    }

    #[initializer]
    #[public]
    fn setup() {
        storage.owner.write(context.msg_sender());
    }

    #[private]
    fn create_note_for_user(value: u128) {
        let note_owner = context.msg_sender();
        storage.user_private_state.at(note_owner)
        // randomness should actually be random, but is a workaround because we can't recover it now
            .insert(UintNote { value, owner: note_owner, randomness: 6969 })
            .emit(encode_and_encrypt_note_unconstrained(&mut context, note_owner, note_owner));
    }

    #[public]
    fn modify_public_state_for_user(value: u128) {
        storage.user_public_state.at(context.msg_sender()).write(value);
    }

    #[private]
    fn modify_private_state_for_contract(value: u128) {
        let maybe_contract_owner = context.msg_sender();

        storage.contract_private_state.initialize_or_replace(UintNote::new(value, maybe_contract_owner))
            .emit(encode_and_encrypt_note_unconstrained(&mut context, maybe_contract_owner, maybe_contract_owner));

        GettingStarted::at(context.this_address())._assert_is_owner(maybe_contract_owner).enqueue(&mut context);
    }

    #[public]
    #[internal]
    fn _assert_is_owner(maybe_owner: AztecAddress) {
        assert_eq(maybe_owner, storage.owner.read());
    }

    #[public]
    fn modify_public_state_for_contract(value: u128) {
        let maybe_contract_owner = context.msg_sender();

        GettingStarted::at(context.this_address())._assert_is_owner(maybe_contract_owner).call(&mut context);

        storage.user_public_state.at(context.msg_sender()).write(value);
    }

    #[utility]
    unconstrained fn view_created_notes(owner: AztecAddress) -> BoundedVec<UintNote, MAX_NOTES_PER_PAGE> {
        storage.user_private_state.at(owner).view_notes(NoteViewerOptions::new())
    }
}
