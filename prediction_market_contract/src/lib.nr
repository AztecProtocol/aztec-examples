/// Constant Sum Market Maker (CSMM) pricing functions for prediction markets
///
/// ## Core Invariant
/// For a CSMM, we maintain: `price_YES + price_NO = 1`
///
/// This is achieved by tracking supplies such that:
/// - price_YES = yes_supply / total_supply
/// - price_NO = no_supply / total_supply
/// - yes_supply + no_supply = total_supply
///
/// ## Bonding Curve Behavior
///
/// The CSMM has **linear** slippage characteristics:
/// - Buying increases price linearly with amount
/// - No exponential price impact like in CPMMs (constant product)
/// - More capital efficient for prediction markets
///
/// ### Comparison with other curves:
///
/// **CSMM (this implementation):**
/// - Linear price impact
/// - Simple to understand
/// - Good for binary outcomes
/// - Can have infinite slippage at extremes (price -> 1)
///
/// **CPMM (Uniswap style, x*y=k):**
/// - Exponential price impact
/// - Never runs out of liquidity
/// - Poor for bounded outcomes (0-1)
/// - High slippage near extremes
///
/// **LMSR (Logarithmic Market Scoring Rule):**
/// - Logarithmic price impact
/// - Subsidized liquidity from market maker
/// - More complex math
/// - Better price discovery but capital inefficient
///
/// ## Example Bonding Curve:
///
/// Starting state: YES=500, NO=500, liquidity=1000
/// price_YES = 500/1000 = 0.5
///
/// Buy $100 of YES:
/// - Current price: 0.5
/// - Shares out: 100/0.5 = 200
/// - New YES supply: 500 + 200 = 700
/// - New liquidity: 1000 + 100 = 1100
/// - New price: 700/1100 = 0.636
///
/// Notice: The price moved from 0.5 -> 0.636 for a $100 purchase.
/// This is LINEAR slippage!

/// Fixed-point precision for calculations
pub global PRICE_PRECISION: u128 = 1_000_000;

/// Calculate how many outcome shares a buyer receives for their collateral
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
    assert(total_liquidity > 0 as u128, "ZERO_LIQUIDITY");
    assert(collateral_amount > 0 as u128, "ZERO_COLLATERAL");

    // Calculate current price as fixed-point
    // price = (current_supply * PRICE_PRECISION) / total_liquidity
    let current_price = (current_supply * PRICE_PRECISION) / total_liquidity;

    // Prevent division by zero (price can't be zero unless supply is zero)
    assert(current_price > 0 as u128, "ZERO_PRICE");

    // Calculate shares out
    // shares = (collateral_amount * PRICE_PRECISION) / current_price
    let shares_out = (collateral_amount * PRICE_PRECISION) / current_price;

    assert(shares_out > 0 as u128, "INSUFFICIENT_OUTPUT");

    let new_supply = current_supply + shares_out;

    (shares_out, new_supply)
}

/// Calculate the current price of an outcome token
///
/// Formula: price = supply / total_supply
/// Returns: price as fixed-point (price * PRICE_PRECISION)
pub fn calculate_new_price(supply: u128, total_supply: u128) -> u128 {
    assert(total_supply > 0 as u128, "ZERO_TOTAL_SUPPLY");

    // Return as fixed-point: (supply * PRICE_PRECISION) / total_supply
    (supply * PRICE_PRECISION) / total_supply
}

/// Calculate price impact of a purchase
///
/// Returns: (price_before, price_after, price_impact_percentage)
/// All as fixed-point values
pub fn calculate_price_impact(
    collateral_amount: u128,
    current_supply: u128,
    total_liquidity: u128,
) -> (u128, u128, u128) {
    let price_before = calculate_new_price(current_supply, total_liquidity);

    let (shares_out, new_supply) = calculate_shares_out(
        collateral_amount,
        current_supply,
        total_liquidity,
    );

    let new_total = total_liquidity + collateral_amount;
    let price_after = calculate_new_price(new_supply, new_total);

    // Calculate percentage impact (as fixed-point)
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
    // At 50/50 odds: supply=500, liquidity=1000
    // Price = 500/1000 = 0.5
    // Buying 100 collateral should give 200 shares (100/0.5)
    let collateral = 100 as u128;
    let supply = 500 as u128;
    let liquidity = 1000 as u128;

    let (shares_out, new_supply) = calculate_shares_out(collateral, supply, liquidity);

    assert(shares_out == 200, "Expected 200 shares at 50/50 odds");
    assert(new_supply == 700, "Expected new supply of 700");
}

#[test]
fn test_calculate_shares_out_at_different_price() {
    // At 70/30 odds: supply=700, liquidity=1000
    // Price = 700/1000 = 0.7
    // Buying 70 collateral should give 100 shares (70/0.7)
    let collateral = 70 as u128;
    let supply = 700 as u128;
    let liquidity = 1000 as u128;

    let (shares_out, new_supply) = calculate_shares_out(collateral, supply, liquidity);

    assert(shares_out == 100, "Expected 100 shares at 70% price");
    assert(new_supply == 800, "Expected new supply of 800");
}

#[test]
fn test_calculate_new_price_50_50() {
    // At 50/50: price should be 500000 (0.5 * PRICE_PRECISION)
    let supply = 500 as u128;
    let total = 1000 as u128;

    let price = calculate_new_price(supply, total);

    assert(price == 500000, "Expected price of 500000 (50%)");
}

#[test]
fn test_calculate_new_price_70_30() {
    // At 70/30: YES price should be 700000 (0.7 * PRICE_PRECISION)
    let supply = 700 as u128;
    let total = 1000 as u128;

    let price = calculate_new_price(supply, total);

    assert(price == 700000, "Expected price of 700000 (70%)");
}

#[test]
fn test_calculate_price_impact() {
    // Starting at 50/50, buying 100 should move price from 0.5 to ~0.636
    let collateral = 100 as u128;
    let supply = 500 as u128;
    let liquidity = 1000 as u128;

    let (price_before, price_after, impact) = calculate_price_impact(collateral, supply, liquidity);

    assert(price_before == 500000, "Expected price_before of 500000");
    // After: new_supply=700, new_liquidity=1100, price = 700/1100 = 0.636...
    assert(price_after == 636363, "Expected price_after of ~636363");
    // Impact: (636363 - 500000) / 500000 * 1000000 = 272726
    assert(impact == 272726, "Expected impact of ~272726");
}

#[test]
fn test_prices_sum_to_one() {
    // YES price + NO price should always equal PRICE_PRECISION (1.0)
    let yes_supply = 600 as u128;
    let no_supply = 400 as u128;
    let total = yes_supply + no_supply;

    let yes_price = calculate_new_price(yes_supply, total);
    let no_price = calculate_new_price(no_supply, total);

    assert(yes_price + no_price == PRICE_PRECISION, "Prices should sum to 1.0");
}

#[test]
fn test_large_purchase() {
    // Test with larger numbers to ensure no overflow issues
    let collateral = 10000 as u128;
    let supply = 50000 as u128;
    let liquidity = 100000 as u128;

    let (shares_out, new_supply) = calculate_shares_out(collateral, supply, liquidity);

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
