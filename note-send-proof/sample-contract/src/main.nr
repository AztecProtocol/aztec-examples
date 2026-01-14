use aztec::macros::aztec;

#[aztec]
pub contract GettingStarted {
    use aztec::{
        state_vars::PublicMutable,
        macros::{
            functions::{initializer, external},
            storage::storage,
        },
        protocol_types::address::AztecAddress,
    };

    use uint_note::uint_note::{UintNote, create_note_with_randomness};

    // Fixed randomness for reproducible hash computation verification
    global NOTE_RANDOMNESS: Field = 6969;

    #[storage]
    struct Storage<Context> {
        owner: PublicMutable<AztecAddress, Context>,
    }

    #[initializer]
    #[external("public")]
    fn setup(owner: AztecAddress) {
        self.storage.owner.write(owner);
    }

    /// Creates a private note with a fixed randomness value.
    /// The fixed randomness allows external verification of the note hash computation.
    #[external("private")]
    fn create_note_for_user(value: u128) {
        let note_owner = self.context.msg_sender().unwrap();
        let note = UintNote::new(value);

        // Use storage slot 1 for user notes (we're not using a Map, just a simple slot)
        let storage_slot = 1;

        create_note_with_randomness(
            self.context,
            note_owner,
            storage_slot,
            note,
            NOTE_RANDOMNESS,
        );
    }

    #[external("utility")]
    unconstrained fn get_owner() -> AztecAddress {
        self.storage.owner.read()
    }
}
