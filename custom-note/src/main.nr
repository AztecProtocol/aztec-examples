use aztec::macros::aztec;

mod custom_note;

#[aztec]
pub contract CustomNoteContract {
    use aztec::macros::{
        functions::external,
        storage::storage,
    };
    use aztec::state_vars::{PrivateSet, Owned};
    use aztec::protocol_types::address::AztecAddress;
    use aztec::messages::message_delivery::MessageDelivery;
    use aztec::note::constants::MAX_NOTES_PER_PAGE;
    use aztec::note::note_viewer_options::NoteViewerOptions;

    use crate::custom_note::CustomNote;

    #[storage]
    struct Storage<Context> {
        custom_notes: Owned<PrivateSet<CustomNote, Context>, Context>,
    }

    #[external("private")]
    fn insert(a: Field, b: Field, c: Field, d: Field) {
        let sender = self.context.msg_sender().unwrap();
        let note = CustomNote::new(a, b, c, d, sender);
        self.storage.custom_notes
            .at(sender)
            .insert(note)
            .deliver(MessageDelivery.UNCONSTRAINED_ONCHAIN);
    }

    #[external("utility")]
    unconstrained fn view_custom_notes(owner: AztecAddress) -> BoundedVec<CustomNote, MAX_NOTES_PER_PAGE> {
        self.storage.custom_notes.at(owner).view_notes(NoteViewerOptions::new())
    }
}
