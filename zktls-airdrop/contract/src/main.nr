use aztec::macros::aztec;

/// Fully-private airdrop contract that distributes tokens to verified
/// contributors of the primus-labs GitHub organization, using the
/// defi-wonderland/aztec-standards Token contract for minting.
///
/// Privacy properties:
///   - The GitHub username and ID never appear on-chain in any form.
///   - The claim nullifier (Poseidon2 hash of GitHub ID) is siloed by the
///     contract address and cannot be linked to the raw ID.
///   - Token balances are encrypted private notes in the Token contract;
///     only the owner can read them.
///   - The only public data is the immutable config set at deploy time.
///
/// Deployment order:
///   1. Deploy PrimusAirdrop (stores deployer, url hashes, amount).
///   2. Deploy Token with `constructor_with_minter(minter = airdrop.address)`.
///   3. Call `airdrop.set_token(token.address)` -- one-time initialization.
///
/// Claim flow:
///   1. Off-chain: contributor generates a Primus zkTLS attestation.
///   2. `claim` (private):
///      a. Verifies ECDSA-signed attestation and SHA-256 content hashes.
///      b. Checks attested URL hashes against the stored allowed list.
///      c. Emits a nullifier derived from the GitHub ID (prevents re-use).
///      d. Cross-contract calls `Token.mint_to_private(claimer, amount)`.
#[aztec]
pub contract PrimusAirdrop {
    use att_verifier_lib::verify_attestation_hashing;
    use poseidon::poseidon2::Poseidon2;
    use token_contract::Token;

    use aztec::{
        macros::{
            functions::{external, initializer},
            storage::storage,
        },
        protocol::address::AztecAddress,
        state_vars::PublicImmutable,
    };

    // ---------------------------------------------------------------------------
    // Constants -- must match the attestation parsing configuration
    // ---------------------------------------------------------------------------

    global MAX_URL_LEN: u32 = 128;
    global MAX_PLAINTEXT_LEN: u32 = 50;
    global NUM_RESPONSE_RESOLVE: u32 = 2;
    global NUM_ALLOWED_URLS: u32 = 3;

    // ---------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------

    #[storage]
    struct Storage<Context> {
        /// The address that deployed this contract (can call set_token once).
        deployer: PublicImmutable<AztecAddress, Context>,

        /// Address of the Token contract (set once via set_token).
        /// The Token must have this airdrop contract as its minter.
        token: PublicImmutable<AztecAddress, Context>,

        /// Poseidon2 hashes of the allowed URL prefixes.
        allowed_url_hashes: PublicImmutable<[Field; NUM_ALLOWED_URLS], Context>,

        /// Tokens awarded per claim.
        airdrop_amount: PublicImmutable<Field, Context>,
    }

    // ---------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------

    #[initializer]
    #[external("public")]
    fn constructor(
        deployer: AztecAddress,
        allowed_url_hashes: [Field; NUM_ALLOWED_URLS],
        airdrop_amount: Field,
    ) {
        assert(!deployer.is_zero(), "invalid deployer");
        self.storage.deployer.initialize(deployer);
        self.storage.allowed_url_hashes.initialize(allowed_url_hashes);
        self.storage.airdrop_amount.initialize(airdrop_amount);
    }

    // ---------------------------------------------------------------------------
    // One-time token initialization
    // ---------------------------------------------------------------------------

    /// Set the Token contract address. Can only be called once, by the deployer.
    /// Call this after deploying the Token with minter = this contract's address.
    #[external("public")]
    fn set_token(token: AztecAddress) {
        assert(!token.is_zero(), "invalid token address");
        assert(
            self.storage.deployer.read().eq(self.msg_sender()),
            "only deployer can set token",
        );
        // PublicImmutable::initialize fails if already set -- enforces one-time use.
        self.storage.token.initialize(token);
    }

    // ---------------------------------------------------------------------------
    // Private: verify zkTLS attestation, prevent double-claim, mint tokens
    // ---------------------------------------------------------------------------

    /// Verifies a Primus zkTLS hash-based attestation proving the caller is a
    /// contributor to a primus-labs GitHub repository, then mints airdrop
    /// tokens via the Token contract's `mint_to_private`.
    ///
    /// Double-claim prevention: a nullifier derived from the GitHub ID is
    /// emitted. Duplicate nullifiers are rejected by the protocol.
    #[external("private")]
    fn claim(
        // -- Attestation cryptographic fields --
        public_key_x: [u8; 32],
        public_key_y: [u8; 32],
        hash: [u8; 32],
        signature: [u8; 64],
        // -- URL data (2 request URLs required by verify_attestation_hashing) --
        request_urls: [BoundedVec<u8, MAX_URL_LEN>; 2],
        allowed_urls: [BoundedVec<u8, MAX_URL_LEN>; NUM_ALLOWED_URLS],
        // -- Response content verification --
        data_hashes: [[u8; 32]; NUM_RESPONSE_RESOLVE],
        contents: [BoundedVec<u8, MAX_PLAINTEXT_LEN>; NUM_RESPONSE_RESOLVE],
        // -- Claimed identity --
        github_username: BoundedVec<u8, MAX_PLAINTEXT_LEN>,
        github_id: BoundedVec<u8, MAX_PLAINTEXT_LEN>,
    ) {
        // 1. Verify the zkTLS attestation.
        let url_hashes: [Field; 2] = verify_attestation_hashing(
            public_key_x,
            public_key_y,
            hash,
            signature,
            request_urls,
            allowed_urls,
            data_hashes,
            contents,
        );

        // 2. Check URL hashes against the immutable allowed list.
        let stored = self.storage.allowed_url_hashes.read();
        for i in 0..2 {
            let mut found = false;
            for j in 0..NUM_ALLOWED_URLS {
                if url_hashes[i] == stored[j] {
                    found = true;
                }
            }
            assert(found, "request URL not in allowed list");
        }

        // 3. Verify attested data matches claimed identity.
        assert(
            contents[0].storage() == github_username.storage(),
            "attested username does not match",
        );
        assert(
            contents[1].storage() == github_id.storage(),
            "attested github id does not match",
        );

        // 4. Double-claim prevention via nullifier.
        let mut id_fields: [Field; MAX_PLAINTEXT_LEN] = [0; MAX_PLAINTEXT_LEN];
        for i in 0..MAX_PLAINTEXT_LEN {
            if i < github_id.len() {
                id_fields[i] = github_id.storage()[i] as Field;
            }
        }
        let claim_nullifier = Poseidon2::hash(id_fields, MAX_PLAINTEXT_LEN);
        self.context.push_nullifier(claim_nullifier);

        // 5. Mint airdrop tokens to the claimer via the Token contract.
        //    This succeeds only if Token.minter == this contract's address.
        let token = self.storage.token.read();
        let amount: u128 = self.storage.airdrop_amount.read() as u128;
        let claimer = self.msg_sender();
        self.call(Token::at(token).mint_to_private(claimer, amount));
    }
}
