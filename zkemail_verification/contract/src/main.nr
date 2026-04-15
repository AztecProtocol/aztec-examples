use aztec::macros::aztec;

#[aztec]
pub contract ZKEmailVerifier {
    use aztec::{
        macros::{functions::{external, initializer, only_self, view}, storage::storage},
        oracle::logging::debug_log_format,
        state_vars::PublicImmutable,
    };
    use bb_proof_verification::{UltraHonkVerificationKey, UltraHonkZKProof, verify_honk_proof};

    #[storage]
    struct Storage<Context> {
        vk_hash: PublicImmutable<Field, Context>,
        /// Pedersen hash of the authorized recipient email address.
        /// Only emails sent TO this address can authorize actions.
        authorized_email_hash: PublicImmutable<Field, Context>,
        /// Maximum allowed age of an email in seconds.
        /// Emails older than this (based on DKIM signing timestamp) are rejected.
        max_email_age: PublicImmutable<Field, Context>,
    }

    #[initializer]
    #[external("public")]
    fn constructor(vk_hash: Field, authorized_email_hash: Field, max_email_age: Field) {
        self.storage.vk_hash.initialize(vk_hash);
        self.storage.authorized_email_hash.initialize(authorized_email_hash);
        self.storage.max_email_age.initialize(max_email_age);
    }

    /// Verify an email proof and authorize an intent.
    ///
    /// The caller provides an expected_intent_hash which must match the hash of
    /// the email's subject field (public_inputs[4]). This binds the email to a
    /// specific action.
    ///
    /// Public inputs layout from the circuit:
    ///   [0]: pubkey_hash[0]  -- DKIM key identity
    ///   [1]: pubkey_hash[1]  -- DKIM key identity
    ///   [2]: email_nullifier -- prevents email reuse
    ///   [3]: to_address_hash -- must match authorized_email_hash
    ///   [4]: intent_hash     -- hash of email subject (action being authorized)
    ///   [5]: dkim_timestamp  -- when the email was signed
    #[external("private")]
    fn verify_email(
        expected_intent_hash: Field,
        verification_key: UltraHonkVerificationKey,
        proof: UltraHonkZKProof,
        public_inputs: [Field; 6],
    ) {
        debug_log_format("Verifying email proof...", []);

        // Verify the ZK proof against the stored verification key hash
        let vk_hash = self.storage.vk_hash.read();
        verify_honk_proof(verification_key, proof, public_inputs, vk_hash);

        // Verify the email was sent to the authorized address
        let authorized_email_hash = self.storage.authorized_email_hash.read();
        assert(
            public_inputs[3] == authorized_email_hash,
            "Email recipient does not match authorized address",
        );

        // Verify the intent matches what the caller expects
        assert(
            public_inputs[4] == expected_intent_hash,
            "Email subject does not match expected intent",
        );

        // Push the email nullifier to prevent reuse of this email proof.
        // The nullifier is automatically siloed by the contract address.
        // If this nullifier has already been emitted, the transaction will fail.
        self.context.push_nullifier(public_inputs[2]);

        // Enqueue a public call to verify the email timestamp is fresh enough.
        // This must be checked in public context where the block timestamp is available.
        let max_email_age = self.storage.max_email_age.read();
        self.enqueue_self._check_email_freshness(public_inputs[5], max_email_age);
    }

    /// Public function to verify the email's DKIM timestamp is recent enough.
    /// Called via enqueue from the private verify_email function.
    #[only_self]
    #[external("public")]
    fn _check_email_freshness(email_timestamp: Field, max_age: Field) {
        let current_ts: u64 = self.context.timestamp();
        let email_ts: u64 = email_timestamp as u64;
        let max_age_secs: u64 = max_age as u64;

        assert(current_ts >= email_ts, "Email timestamp is in the future");
        assert(
            current_ts - email_ts <= max_age_secs,
            "Email has expired -- DKIM timestamp is too old",
        );
    }

    #[view]
    #[external("public")]
    fn get_authorized_email_hash() -> Field {
        self.storage.authorized_email_hash.read()
    }

    #[view]
    #[external("public")]
    fn get_max_email_age() -> Field {
        self.storage.max_email_age.read()
    }
}
