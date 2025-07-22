use dep::aztec::protocol_types::{
    address::AztecAddress,
    constants::{GENERATOR_INDEX__SILOED_NOTE_HASH, GENERATOR_INDEX__UNIQUE_NOTE_HASH}, 
    traits::FromField,
};
use dep::aztec::note::note_interface::NoteHash;
use dep::poseidon;

use uint_note::uint_note::UintNote;

fn main(
    settled_note_hash: pub Field,
    contract_address: pub Field,
    recipient: pub Field,
    randomness: Field,
    value: pub u128,
    storage_slot: Field,
    note_nonce: Field,
) {
    let note = UintNote { value, randomness, owner: AztecAddress::from_field(recipient) };
    let note_hash = note.compute_note_hash(storage_slot);

    let siloed_note_hash = poseidon::poseidon2::Poseidon2::hash([GENERATOR_INDEX__SILOED_NOTE_HASH as Field, contract_address, note_hash], 3);
    let unique_note_hash = poseidon::poseidon2::Poseidon2::hash([GENERATOR_INDEX__UNIQUE_NOTE_HASH as Field, note_nonce, siloed_note_hash], 3);

    assert_eq(settled_note_hash, unique_note_hash);
}
