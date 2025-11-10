use aztec::macros::aztec;

mod custom_note;

#[aztec]
pub contract CustomNote {
    use aztec::macros::{
        functions::external,
        storage::storage,
    };
    use aztec::state_vars::{Map, PrivateSet};
    use aztec::protocol_types::address::AztecAddress;
    use aztec::messages::message_delivery::MessageDelivery;
    use aztec::note::constants::MAX_NOTES_PER_PAGE;
    use aztec::note::note_viewer_options::NoteViewerOptions;

    use crate::custom_note::CustomNote;


    #[storage]
    struct Storage<Context> {
        custom_notes: Map<AztecAddress, PrivateSet<CustomNote, Context>, Context>,
    }

    #[external("private")]
    fn insert(a: Field, b: Field, c: Field, d: Field) {
        self.storage.custom_notes.at(self.msg_sender().unwrap())
            .insert(CustomNote::new(a, b, c, d, self.msg_sender().unwrap()))
            .emit(self.msg_sender().unwrap(), MessageDelivery.UNCONSTRAINED_ONCHAIN);
    }

    #[external("utility")]
    unconstrained fn view_custom_notes(owner: AztecAddress) -> [CustomNote; MAX_NOTES_PER_PAGE] {
        let notes = self.storage.custom_notes.at(owner).view_notes(NoteViewerOptions::new());
        notes.storage()
    }
}
