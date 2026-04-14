use aztec::protocol::traits::{Deserialize, Packable, Serialize};

/// A limit order in the prediction market CLOB.
///
/// No maker address -- identity is hidden inside the encrypted partial note.
/// The order_id = cancel_hash = Poseidon2(cancel_secret), which the client
/// can compute deterministically. The maker_note field stores the serialized
/// partial note for share delivery on fill.
#[derive(Deserialize, Eq, Serialize)]
pub struct Order {
    /// true = buying YES shares, false = buying NO shares
    pub is_buy_yes: bool,
    /// Price per share in PRICE_PRECISION scale (1_000_000 = 1.0)
    /// e.g. 750_000 means 0.75 collateral per share
    pub price: u128,
    /// Number of shares desired
    pub amount: u128,
    /// Poseidon2(cancel_secret) -- proves cancellation authority.
    /// Also serves as the order_id for deterministic client-side computation.
    pub cancel_hash: Field,
    /// Serialized PartialUintNote for delivering shares to the maker on fill.
    pub maker_note: Field,
}

impl Packable for Order {
    let N: u32 = 4;

    fn pack(self) -> [Field; Self::N] {
        [
            (self.price as Field) * 2 + (self.is_buy_yes as Field),
            self.amount as Field,
            self.cancel_hash,
            self.maker_note,
        ]
    }

    fn unpack(packed: [Field; Self::N]) -> Self {
        let is_buy_yes = (packed[0] as u1) != 0;
        let price = ((packed[0] - is_buy_yes as Field) / 2) as u128;
        let amount = packed[1] as u128;
        let cancel_hash = packed[2];
        let maker_note = packed[3];
        Self { is_buy_yes, price, amount, cancel_hash, maker_note }
    }
}

pub global PRICE_PRECISION: u128 = 1_000_000;

impl Order {
    pub fn new(
        is_buy_yes: bool,
        price: u128,
        amount: u128,
        cancel_hash: Field,
        maker_note: Field,
    ) -> Self {
        assert(price > 0, "ZERO_PRICE");
        assert(price < PRICE_PRECISION, "PRICE_TOO_HIGH");
        assert(amount > 0, "ZERO_AMOUNT");
        assert(cancel_hash != 0, "ZERO_CANCEL_HASH");

        Self { is_buy_yes, price, amount, cancel_hash, maker_note }
    }
}

// ============================================================================
// TESTS
// ============================================================================

mod test {
    use crate::order::{Order, PRICE_PRECISION};
    use aztec::protocol::traits::Packable;

    #[test]
    fn test_pack_unpack_buy_yes() {
        let order = Order {
            is_buy_yes: true,
            price: 750_000,
            amount: 1000,
            cancel_hash: 0x1234,
            maker_note: 0x5678,
        };
        let unpacked = Order::unpack(order.pack());
        assert_eq(unpacked.price, order.price);
        assert_eq(unpacked.amount, order.amount);
        assert(unpacked.is_buy_yes);
        assert_eq(unpacked.cancel_hash, order.cancel_hash);
        assert_eq(unpacked.maker_note, order.maker_note);
    }

    #[test]
    fn test_pack_unpack_buy_no() {
        let order = Order {
            is_buy_yes: false,
            price: 250_000,
            amount: 500,
            cancel_hash: 0xabcd,
            maker_note: 0xef01,
        };
        let unpacked = Order::unpack(order.pack());
        assert_eq(unpacked.price, order.price);
        assert_eq(unpacked.amount, order.amount);
        assert(!unpacked.is_buy_yes);
        assert_eq(unpacked.cancel_hash, order.cancel_hash);
        assert_eq(unpacked.maker_note, order.maker_note);
    }

    #[test]
    fn test_pack_unpack_max_price() {
        let order = Order {
            is_buy_yes: true,
            price: PRICE_PRECISION - 1,
            amount: 0xffffffffffffffffffffffffffffffff,
            cancel_hash: 0xdeadbeef,
            maker_note: 0xcafe,
        };
        let unpacked = Order::unpack(order.pack());
        assert_eq(unpacked.price, order.price);
        assert_eq(unpacked.amount, order.amount);
        assert(unpacked.is_buy_yes);
    }

    #[test]
    fn test_new_valid() {
        let _ = Order::new(true, 500_000, 100, 0x1234, 0x5678);
    }

    #[test(should_fail_with = "ZERO_PRICE")]
    fn test_new_zero_price() {
        let _ = Order::new(true, 0, 100, 0x1234, 0x5678);
    }

    #[test(should_fail_with = "PRICE_TOO_HIGH")]
    fn test_new_price_too_high() {
        let _ = Order::new(true, PRICE_PRECISION, 100, 0x1234, 0x5678);
    }

    #[test(should_fail_with = "ZERO_AMOUNT")]
    fn test_new_zero_amount() {
        let _ = Order::new(true, 500_000, 0, 0x1234, 0x5678);
    }

    #[test(should_fail_with = "ZERO_CANCEL_HASH")]
    fn test_new_zero_cancel_hash() {
        let _ = Order::new(true, 500_000, 100, 0, 0x5678);
    }
}
