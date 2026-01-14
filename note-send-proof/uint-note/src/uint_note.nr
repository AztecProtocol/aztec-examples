// Custom UintNote for v3 with controllable randomness for hash verification demos
// Based on aztec-nr UintNote but with create_note_with_randomness function

use aztec::{
    context::PrivateContext,
    keys::getters::{get_nsk_app, get_public_keys},
    macros::notes::custom_note,
    note::note_interface::{NoteHash, NoteType},
    oracle::notes::notify_created_note,
    protocol_types::{
        address::AztecAddress,
        constants::{GENERATOR_INDEX__NOTE_HASH, GENERATOR_INDEX__NOTE_NULLIFIER},
        hash::poseidon2_hash_with_separator,
        traits::{Deserialize, Hash, Packable, Serialize, ToField},
    },
};

/// A private note representing a numeric value associated to an account.
/// This is a simplified version for demonstration purposes.
#[derive(Deserialize, Eq, Serialize, Packable)]
#[custom_note]
pub struct UintNote {
    /// The number stored in the note.
    pub value: u128,
}

impl NoteHash for UintNote {
    fn compute_note_hash(
        self,
        owner: AztecAddress,
        storage_slot: Field,
        randomness: Field,
    ) -> Field {
        // v3 hash computation:
        // 1. commitment = poseidon2([owner, storage_slot, randomness], GENERATOR_INDEX__NOTE_HASH)
        // 2. note_hash = poseidon2([commitment, value], GENERATOR_INDEX__NOTE_HASH)
        let commitment = poseidon2_hash_with_separator(
            [owner.to_field(), storage_slot, randomness],
            GENERATOR_INDEX__NOTE_HASH,
        );
        poseidon2_hash_with_separator(
            [commitment, self.value.to_field()],
            GENERATOR_INDEX__NOTE_HASH,
        )
    }

    fn compute_nullifier(
        self,
        context: &mut PrivateContext,
        owner: AztecAddress,
        note_hash_for_nullification: Field,
    ) -> Field {
        let owner_npk_m = get_public_keys(owner).npk_m;
        let owner_npk_m_hash = owner_npk_m.hash();
        let secret = context.request_nsk_app(owner_npk_m_hash);
        poseidon2_hash_with_separator(
            [note_hash_for_nullification, secret],
            GENERATOR_INDEX__NOTE_NULLIFIER,
        )
    }

    unconstrained fn compute_nullifier_unconstrained(
        self,
        owner: AztecAddress,
        note_hash_for_nullification: Field,
    ) -> Field {
        let owner_npk_m = get_public_keys(owner).npk_m;
        let owner_npk_m_hash = owner_npk_m.hash();
        let secret = get_nsk_app(owner_npk_m_hash);
        poseidon2_hash_with_separator(
            [note_hash_for_nullification, secret],
            GENERATOR_INDEX__NOTE_NULLIFIER,
        )
    }
}

impl UintNote {
    pub fn new(value: u128) -> Self {
        Self { value }
    }
}

/// Creates a note with a specified randomness value and pushes it to the note hash tree.
/// This is useful for demonstrations where we need to verify hash computations.
/// Note: This bypasses normal note discovery - the note hash will be on-chain but
/// standard note retrieval won't work. This is intentional for hash verification demos.
pub fn create_note_with_randomness<Note>(
    context: &mut PrivateContext,
    owner: AztecAddress,
    storage_slot: Field,
    note: Note,
    randomness: Field,
) where
    Note: NoteType + NoteHash + Packable,
{
    let note_hash_counter = context.side_effect_counter;
    let note_hash = note.compute_note_hash(owner, storage_slot, randomness);

    // Notify the PXE about the created note for potential discovery
    notify_created_note(
        owner,
        storage_slot,
        randomness,
        Note::get_id(),
        note.pack(),
        note_hash,
        note_hash_counter,
    );

    // Push the note hash to the note hash tree
    context.push_note_hash(note_hash);
}
