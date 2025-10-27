use aztec::macros::aztec;

#[aztec]
pub contract ValueNotEqual {
    global HONK_VK_SIZE: u32 = 115;
    global HONK_PROOF_SIZE: u32 = 457;
    global HONK_IDENTIFIER: u32 = 1;

    use aztec::{
        macros::{functions::{external, initializer}, storage::storage},
        oracle::debug_log::debug_log_format,
        protocol_types::{address::AztecAddress, traits::ToField},
        state_vars::Map,
    };
    use easy_private_state::EasyPrivateUint;

    #[storage]
    struct Storage<Context> {
        counters: Map<AztecAddress, EasyPrivateUint<Context>, Context>,
    }

    #[initializer]
    #[external("private")]
    fn initialize(headstart: u64, owner: AztecAddress) {
        let counters = storage.counters;
        counters.at(owner).add(headstart, owner);
    }

    #[external("private")]
    fn increment(
        owner: AztecAddress,
        verification_key: [Field; HONK_VK_SIZE],
        proof: [Field; HONK_PROOF_SIZE],
        public_inputs: [Field; 1],
    ) {
        debug_log_format("Incrementing counter for owner {0}", [owner.to_field()]);
        std::verify_proof_with_type(verification_key, proof, public_inputs, 0x0, HONK_IDENTIFIER);
        ValueNotEqual::at(context.this_address()).emit_in_public(12345).enqueue(&mut context);
        let counters = storage.counters;
        counters.at(owner).add(1, owner);
    }

    #[external("public")]
    fn emit_in_public(n: Field) {
        context.push_note_hash(n);
    }

    #[external("utility")]
    unconstrained fn get_counter(owner: AztecAddress) -> Field {
        storage.counters.at(owner).get_value()
    }
}
