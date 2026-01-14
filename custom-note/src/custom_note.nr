use aztec::{
    macros::notes::note,
    oracle::random::random,
    protocol_types::{address::AztecAddress, traits::{Deserialize, Packable, Serialize}},
};

#[derive(Eq, Serialize, Deserialize, Packable)]
#[note]
pub struct CustomNote {
    a: Field,
    b: Field,
    c: Field,
    d: Field,
    owner: AztecAddress,
    randomness: Field,
}

impl CustomNote {
    pub fn new(a: Field, b: Field, c: Field, d: Field, owner: AztecAddress) -> Self {
        // Safety: We use the randomness to preserve the privacy of the note recipient by preventing brute-forcing,
        // so a malicious sender could use non-random values to make the note less private. But they already know
        // the full note pre-image anyway, and so the recipient already trusts them to not disclose this
        // information. We can therefore assume that the sender will cooperate in the random value generation.
        let randomness = unsafe { random() };
        CustomNote {
            a, b, c, d,
            owner,
            randomness
        }
    }

    pub fn get_a(self) -> Field {
        self.a
    }

    pub fn get_b(self) -> Field {
        self.b
    }

    pub fn get_c(self) -> Field {
        self.c
    }

    pub fn get_d(self) -> Field {
        self.d
    }
}
