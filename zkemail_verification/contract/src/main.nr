use aztec::macros::aztec;

#[aztec]
pub contract ZKEmailVerifier {
    use aztec::{
        macros::{functions::{external, initializer, only_self, view}, storage::storage},
        oracle::logging::debug_log_format,
        protocol::{address::AztecAddress, traits::ToField},
        state_vars::{Map, PublicImmutable, PublicMutable},
    };
    use bb_proof_verification::{UltraHonkVerificationKey, UltraHonkZKProof, verify_honk_proof};

    #[storage]
    struct Storage<Context> {
        verification_count: Map<AztecAddress, PublicMutable<Field, Context>, Context>,
        vk_hash: PublicImmutable<Field, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(owner: AztecAddress, vk_hash: Field) {
        self.storage.verification_count.at(owner).write(0);
        self.storage.vk_hash.initialize(vk_hash);
    }

    #[external("private")]
    fn verify_email(
        owner: AztecAddress,
        verification_key: UltraHonkVerificationKey,
        proof: UltraHonkZKProof,
        public_inputs: [Field; 3],
    ) {
        debug_log_format("Verifying email proof for owner {0}", [owner.to_field()]);
        let vk_hash = self.storage.vk_hash.read();
        verify_honk_proof(verification_key, proof, public_inputs, vk_hash);
        self.enqueue_self._increment_verification_count(owner);
    }

    #[only_self]
    #[external("public")]
    fn _increment_verification_count(owner: AztecAddress) {
        let current = self.storage.verification_count.at(owner).read();
        self.storage.verification_count.at(owner).write(current + 1);
    }

    #[view]
    #[external("public")]
    fn get_verification_count(owner: AztecAddress) -> Field {
        self.storage.verification_count.at(owner).read()
    }
}
