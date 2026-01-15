use std::embedded_curve_ops::EmbeddedCurvePoint;

/// Off-chain account ownership proof circuit for Schnorr accounts.
///
/// This circuit proves that the prover knows a valid Schnorr signature
/// for a given public key and challenge message. The verification key (VK)
/// of this circuit can be compared against what's committed to in an
/// Aztec account's address derivation to verify legitimate ownership.
///
/// Public inputs:
/// - pub_key_x: x-coordinate of the signing public key
/// - pub_key_y: y-coordinate of the signing public key
/// - challenge: 32-byte challenge message (should be fresh/random per verification)
///
/// Private inputs:
/// - signature: 64-byte Schnorr signature (s: 32 bytes, e: 32 bytes)
fn main(
    // Public inputs - visible to verifier
    pub_key_x: pub Field,
    pub_key_y: pub Field,
    challenge: pub [u8; 32],

    // Private input - signature (not revealed)
    signature: [u8; 64],
) {
    // Construct the public key point
    let pub_key = EmbeddedCurvePoint {
        x: pub_key_x,
        y: pub_key_y,
        is_infinite: false,
    };

    // Verify the Schnorr signature
    // This is the same verification logic used in Aztec's Schnorr account contract
    let is_valid = schnorr::verify_signature(pub_key, signature, challenge);

    assert(is_valid, "Invalid Schnorr signature");
}

// Tests are run via TypeScript using bun test
// The circuit is tested end-to-end with real Schnorr signatures generated
// by the @aztec/foundation/crypto/schnorr library
