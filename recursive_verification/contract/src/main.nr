use aztec::macros::aztec;

#[aztec]
pub contract ValueNotEqual {
    use aztec::{
        macros::{functions::{external, initializer, internal, only_self, view}, storage::storage},
        oracle::debug_log::debug_log_format,
        protocol_types::{address::AztecAddress, traits::ToField},
        state_vars::{Map, PublicImmutable, PublicMutable},
    };
    use bb_proof_verification::{UltraHonkVerificationKey, UltraHonkZKProof, verify_honk_proof};

    #[storage]
    struct Storage<Context> {
        counters: Map<AztecAddress, PublicMutable<Field, Context>, Context>,
        vk_hash: PublicImmutable<Field, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(headstart: Field, owner: AztecAddress, vk_hash: Field) {
        self.storage.counters.at(owner).write(headstart);
        self.storage.vk_hash.initialize(vk_hash);
    }

    #[external("private")]
    fn increment(
        owner: AztecAddress,
        verification_key: UltraHonkVerificationKey,
        proof: UltraHonkZKProof,
        public_inputs: [Field; 1],
    ) {
        debug_log_format("Incrementing counter for owner {0}", [owner.to_field()]);
        let vk_hash = self.storage.vk_hash.read();
        verify_honk_proof(verification_key, proof, public_inputs, vk_hash);
        self.enqueue_self._increment_public(owner);
    }

    #[only_self]
    #[external("public")]
    fn _increment_public(owner: AztecAddress) {
        let current = self.storage.counters.at(owner).read();
        self.storage.counters.at(owner).write(current + 1);
    }

    #[view]
    #[external("public")]
    fn get_counter(owner: AztecAddress) -> Field {
        self.storage.counters.at(owner).read()
    }
}
