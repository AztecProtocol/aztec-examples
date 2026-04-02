/// Constant Sum Market Maker (CSMM) pricing functions for prediction markets
///
/// Core Invariant: price_YES + price_NO = 1
///
/// Pricing:
/// - price_YES = yes_supply / total_supply
/// - price_NO = no_supply / total_supply
/// - Buying increases price linearly with amount

/// Fixed-point precision for calculations
pub global PRICE_PRECISION: u128 = 1_000_000;

/// Calculate how many outcome shares a buyer receives for their collateral.
///
/// Formula:
/// - current_price = current_supply / total_liquidity
/// - shares_out = collateral_amount / current_price
/// - new_supply = current_supply + shares_out
///
/// Returns: (shares_out, new_supply)
pub fn calculate_shares_out(
    collateral_amount: u128,
    current_supply: u128,
    total_liquidity: u128,
) -> (u128, u128) {
    assert(total_liquidity > 0, "ZERO_LIQUIDITY");
    assert(collateral_amount > 0, "ZERO_COLLATERAL");

    let current_price = (current_supply * PRICE_PRECISION) / total_liquidity;
    assert(current_price > 0, "ZERO_PRICE");

    let shares_out = (collateral_amount * PRICE_PRECISION) / current_price;
    assert(shares_out > 0, "INSUFFICIENT_OUTPUT");

    let new_supply = current_supply + shares_out;
    (shares_out, new_supply)
}

/// Calculate the current price of an outcome token.
/// Returns: price as fixed-point (price * PRICE_PRECISION)
pub fn calculate_new_price(supply: u128, total_supply: u128) -> u128 {
    assert(total_supply > 0, "ZERO_TOTAL_SUPPLY");
    (supply * PRICE_PRECISION) / total_supply
}

/// Calculate price impact of a purchase.
/// Returns: (price_before, price_after, price_impact_percentage)
pub fn calculate_price_impact(
    collateral_amount: u128,
    current_supply: u128,
    total_liquidity: u128,
) -> (u128, u128, u128) {
    let price_before = calculate_new_price(current_supply, total_liquidity);

    let (_shares_out, new_supply) = calculate_shares_out(
        collateral_amount,
        current_supply,
        total_liquidity,
    );

    let new_total = total_liquidity + collateral_amount;
    let price_after = calculate_new_price(new_supply, new_total);

    let price_change = if price_after > price_before {
        price_after - price_before
    } else {
        price_before - price_after
    };

    let impact_percentage = (price_change * PRICE_PRECISION) / price_before;

    (price_before, price_after, impact_percentage)
}

// ============================================================================
// TESTS
// ============================================================================

#[test]
fn test_calculate_shares_out_at_50_50() {
    let (shares_out, new_supply) = calculate_shares_out(100, 500, 1000);
    assert(shares_out == 200, "Expected 200 shares at 50/50 odds");
    assert(new_supply == 700, "Expected new supply of 700");
}

#[test]
fn test_calculate_shares_out_at_different_price() {
    let (shares_out, new_supply) = calculate_shares_out(70, 700, 1000);
    assert(shares_out == 100, "Expected 100 shares at 70% price");
    assert(new_supply == 800, "Expected new supply of 800");
}

#[test]
fn test_calculate_new_price_50_50() {
    let price = calculate_new_price(500, 1000);
    assert(price == 500000, "Expected price of 500000 (50%)");
}

#[test]
fn test_calculate_new_price_70_30() {
    let price = calculate_new_price(700, 1000);
    assert(price == 700000, "Expected price of 700000 (70%)");
}

#[test]
fn test_calculate_price_impact() {
    let (price_before, price_after, impact) = calculate_price_impact(100, 500, 1000);
    assert(price_before == 500000, "Expected price_before of 500000");
    assert(price_after == 636363, "Expected price_after of ~636363");
    assert(impact == 272726, "Expected impact of ~272726");
}

#[test]
fn test_prices_sum_to_one() {
    let yes_price = calculate_new_price(600, 1000);
    let no_price = calculate_new_price(400, 1000);
    assert(yes_price + no_price == PRICE_PRECISION, "Prices should sum to 1.0");
}

#[test]
fn test_large_purchase() {
    let (shares_out, new_supply) = calculate_shares_out(10000, 50000, 100000);
    assert(shares_out == 20000, "Expected 20000 shares");
    assert(new_supply == 70000, "Expected new supply of 70000");
}

#[test(should_fail_with = "ZERO_LIQUIDITY")]
fn test_zero_liquidity_fails() {
    let _ = calculate_shares_out(100, 50, 0);
}

#[test(should_fail_with = "ZERO_COLLATERAL")]
fn test_zero_collateral_fails() {
    let _ = calculate_shares_out(0, 50, 100);
}

#[test(should_fail_with = "ZERO_TOTAL_SUPPLY")]
fn test_zero_total_supply_fails() {
    let _ = calculate_new_price(50, 0);
}
