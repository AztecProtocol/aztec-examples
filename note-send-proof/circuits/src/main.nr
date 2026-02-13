use aztec::protocol::{
    address::AztecAddress,
    hash::{compute_siloed_note_hash, compute_unique_note_hash},
    traits::FromField,
};
use aztec::note::note_interface::NoteHash;

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
    let owner = AztecAddress::from_field(recipient);
    let note = UintNote::new(value);
    let note_hash = note.compute_note_hash(owner, storage_slot, randomness);

    let siloed_note_hash = compute_siloed_note_hash(AztecAddress::from_field(contract_address), note_hash);
    let unique_note_hash = compute_unique_note_hash(note_nonce, siloed_note_hash);

    assert_eq(settled_note_hash, unique_note_hash);
}
