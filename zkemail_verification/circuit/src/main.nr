use sha256::sha256_var;
use std::{collections::bounded_vec::BoundedVec, hash::pedersen_hash};
use zkemail::{
    dkim::RSAPubkey, headers::body_hash::get_body_hash,
    headers::email_address::get_email_address, KEY_LIMBS_2048, MAX_EMAIL_ADDRESS_LENGTH, Sequence,
};

global MAX_EMAIL_HEADER_LENGTH: u32 = 512;
global MAX_EMAIL_BODY_LENGTH: u32 = 1024;
global EXPECTED_DOMAIN: [u8; 10] = comptime { "icloud.com".as_bytes() };

/// Verify a DKIM-signed email from the icloud.com domain
///
/// Returns:
///   [0]: Poseidon hash of DKIM public key modulus
///   [1]: Poseidon hash of DKIM public key redc parameter
///   [2]: Pedersen hash of DKIM signature (email nullifier)
fn main(
    header: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH>,
    body: BoundedVec<u8, MAX_EMAIL_BODY_LENGTH>,
    pubkey: RSAPubkey<KEY_LIMBS_2048>,
    signature: [Field; KEY_LIMBS_2048],
    body_hash_index: u32,
    dkim_header_sequence: Sequence,
    from_header_sequence: Sequence,
    from_address_sequence: Sequence,
) -> pub [Field; 3] {
    assert(header.len() <= MAX_EMAIL_HEADER_LENGTH);
    assert(body.len() <= MAX_EMAIL_BODY_LENGTH);

    // Verify the DKIM signature over the header
    pubkey.verify_dkim_signature(header, signature);

    // Extract the body hash from the DKIM-Signature header and verify against computed body hash
    let signed_body_hash = get_body_hash(header, dkim_header_sequence, body_hash_index);
    let computed_body_hash: [u8; 32] = sha256_var(body.storage(), body.len() as u32);
    assert(
        signed_body_hash == computed_body_hash,
        "SHA256 hash computed over body does not match body hash found in DKIM-signed header",
    );

    // Extract the from email address
    let from_field_name = comptime { "from".as_bytes() };
    let from_address: BoundedVec<u8, MAX_EMAIL_ADDRESS_LENGTH> =
        get_email_address(header, from_header_sequence, from_address_sequence, from_field_name);

    // Find the '@' in the from address and verify the domain matches "icloud.com"
    let mut at_index: u32 = 0;
    let mut found_at = false;
    for i in 0..MAX_EMAIL_ADDRESS_LENGTH {
        if i < from_address.len() {
            if from_address.get_unchecked(i) == 64 {
                at_index = i + 1;
                found_at = true;
            }
        }
    }
    assert(found_at, "No @ symbol found in from address");

    // Check the domain length matches
    let domain_len = from_address.len() - at_index;
    assert(domain_len == 10, "Domain length does not match icloud.com");

    // Check each byte of the domain
    for i in 0..10 {
        assert(
            from_address.get_unchecked(at_index + i) == EXPECTED_DOMAIN[i],
            "Email domain does not match icloud.com",
        );
    }

    // Compute standard outputs
    let email_nullifier = pedersen_hash(signature);
    let pubkey_hash = pubkey.hash();
    [pubkey_hash[0], pubkey_hash[1], email_nullifier]
}

