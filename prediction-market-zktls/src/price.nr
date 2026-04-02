/// ASCII decimal price parser for Noir circuits.
///
/// Parses a BoundedVec of ASCII bytes representing a decimal number
/// (e.g., b"97234.56") into an integer in cents (9723456_u128).
/// Truncates beyond 2 decimal places.

pub global MAX_PLAINTEXT_LEN: u32 = 50;

pub fn parse_price_cents(bytes: BoundedVec<u8, MAX_PLAINTEXT_LEN>) -> u128 {
    let mut integer_part: u128 = 0;
    let mut decimal_part: u128 = 0;
    let mut decimal_count: u32 = 0;
    let mut past_dot = false;

    for i in 0..MAX_PLAINTEXT_LEN {
        if i < bytes.len() {
            let b = bytes.storage()[i];
            if b == 46 {
                // '.'
                past_dot = true;
            } else if (b >= 48) & (b <= 57) {
                // '0'-'9'
                let digit = (b - 48) as u128;
                if !past_dot {
                    integer_part = integer_part * 10 + digit;
                } else if decimal_count < 2 {
                    decimal_part = decimal_part * 10 + digit;
                    decimal_count += 1;
                }
            }
        }
    }

    // Pad decimal part to exactly 2 digits
    if decimal_count == 0 {
        decimal_part = 0;
    } else if decimal_count == 1 {
        decimal_part = decimal_part * 10;
    }

    integer_part * 100 + decimal_part
}

// ============================================================================
// TESTS
// ============================================================================

fn make_bytes(s: [u8]) -> BoundedVec<u8, MAX_PLAINTEXT_LEN> {
    let mut bv: BoundedVec<u8, MAX_PLAINTEXT_LEN> = BoundedVec::new();
    for i in 0..s.len() {
        bv.push(s[i]);
    }
    bv
}

#[test]
fn test_parse_whole_number() {
    // "97234" = 9723400 cents
    let bytes = make_bytes([57, 55, 50, 51, 52]); // "97234"
    let result = parse_price_cents(bytes);
    assert(result == 9723400, "Expected 9723400 for whole number");
}

#[test]
fn test_parse_two_decimals() {
    // "97234.56" = 9723456 cents
    let bytes = make_bytes([57, 55, 50, 51, 52, 46, 53, 54]); // "97234.56"
    let result = parse_price_cents(bytes);
    assert(result == 9723456, "Expected 9723456");
}

#[test]
fn test_parse_one_decimal() {
    // "100.5" = 10050 cents
    let bytes = make_bytes([49, 48, 48, 46, 53]); // "100.5"
    let result = parse_price_cents(bytes);
    assert(result == 10050, "Expected 10050 for one decimal");
}

#[test]
fn test_parse_more_than_two_decimals() {
    // "100.567" = 10056 cents (truncates third decimal)
    let bytes = make_bytes([49, 48, 48, 46, 53, 54, 55]); // "100.567"
    let result = parse_price_cents(bytes);
    assert(result == 10056, "Expected 10056 (truncate third decimal)");
}

#[test]
fn test_parse_small_price() {
    // "0.99" = 99 cents
    let bytes = make_bytes([48, 46, 57, 57]); // "0.99"
    let result = parse_price_cents(bytes);
    assert(result == 99, "Expected 99 for $0.99");
}

#[test]
fn test_parse_large_price() {
    // "999999.99" = 99999999 cents
    let bytes = make_bytes([57, 57, 57, 57, 57, 57, 46, 57, 57]); // "999999.99"
    let result = parse_price_cents(bytes);
    assert(result == 99999999, "Expected 99999999 for large price");
}

#[test]
fn test_parse_zero() {
    // "0" = 0 cents
    let bytes = make_bytes([48]); // "0"
    let result = parse_price_cents(bytes);
    assert(result == 0, "Expected 0");
}

#[test]
fn test_parse_dot_zero() {
    // "0.00" = 0 cents
    let bytes = make_bytes([48, 46, 48, 48]); // "0.00"
    let result = parse_price_cents(bytes);
    assert(result == 0, "Expected 0 for 0.00");
}
