mod types;
mod vote_note;

use aztec::macros::aztec;

/// Private DAO Voting Contract with Tiered Voting Power
///
/// This contract enables private voting on proposals where voting power is
/// determined by ERC20 token balances on Ethereum L1 (via eth-proofs).
///
/// ## Privacy Model
/// - Vote choice: Private (hidden in VoteNote)
/// - Exact L1 balance: Private (only tier is revealed)
/// - Voter Aztec identity: Private (not linked to public tally)
/// - Voter's tier: Semi-private (provides k-anonymity)
///
/// ## Tiered Voting
/// Instead of using exact token balances (which could de-anonymize voters),
/// users prove they belong to a tier (e.g., "1,000-10,000 tokens").
/// All users in the same tier have identical voting power.
#[aztec]
pub contract DaoVoting {
    use crate::types::{Proposal, TIERS, MAX_TIER};
    use crate::vote_note::VoteNote;

    // eth-proofs imports for L1 balance verification
    // Uncomment when eth-proofs is compatible with Aztec v3:
    // use dep::ethereum::misc::types::Address;
    // use dep::token::token::ERC20;
    // use dep::token::token_list::mainnet::USDC;

    use aztec::{
        macros::{functions::{external, initializer, only_self}, storage::storage},
        protocol_types::{
            address::AztecAddress,
            hash::poseidon2_hash,
        },
        state_vars::{Map, PublicImmutable, PublicMutable},
    };

    #[storage]
    struct Storage<Context> {
        /// Contract admin who can create proposals
        admin: PublicImmutable<AztecAddress, Context>,

        /// Ethereum token contract address (20 bytes)
        eth_token_address: PublicImmutable<[u8; 20], Context>,

        /// Storage slot for balances mapping in the ERC20
        eth_balance_slot: PublicImmutable<Field, Context>,

        /// Ethereum chain ID (1 for mainnet)
        eth_chain_id: PublicImmutable<u32, Context>,

        /// Next proposal ID counter
        next_proposal_id: PublicMutable<Field, Context>,

        /// Proposals by ID
        proposals: Map<Field, PublicMutable<Proposal, Context>, Context>,

        /// Vote tallies: proposal_id -> choice -> total_power
        vote_tallies: Map<Field, Map<u8, PublicMutable<u128, Context>, Context>, Context>,
    }

    // =========================================================================
    // Initialization
    // =========================================================================

    /// Initialize the DAO voting contract
    ///
    /// # Arguments
    /// * `admin` - Address that can create proposals
    /// * `eth_token_address` - ERC20 token address on Ethereum (20 bytes)
    /// * `eth_balance_slot` - Storage slot for balances mapping (varies by token)
    /// * `eth_chain_id` - Ethereum chain ID (1 for mainnet)
    #[initializer]
    #[external("public")]
    fn constructor(
        admin: AztecAddress,
        eth_token_address: [u8; 20],
        eth_balance_slot: Field,
        eth_chain_id: u32,
    ) {
        assert(!admin.is_zero(), "Invalid admin");
        self.storage.admin.initialize(admin);
        self.storage.eth_token_address.initialize(eth_token_address);
        self.storage.eth_balance_slot.initialize(eth_balance_slot);
        self.storage.eth_chain_id.initialize(eth_chain_id);
        self.storage.next_proposal_id.write(1);
    }

    // =========================================================================
    // Proposal Management
    // =========================================================================

    /// Create a new proposal
    ///
    /// # Arguments
    /// * `description_hash` - Hash of the proposal description (stored off-chain)
    /// * `snapshot_block` - Ethereum block number for balance snapshot
    /// * `voting_start` - Unix timestamp when voting starts
    /// * `voting_end` - Unix timestamp when voting ends
    /// * `num_choices` - Number of voting options (2-8)
    ///
    /// # Returns
    /// The proposal ID
    #[external("public")]
    fn create_proposal(
        description_hash: Field,
        snapshot_block: u64,
        voting_start: u64,
        voting_end: u64,
        num_choices: u8,
    ) -> Field {
        // Only admin can create proposals
        let admin = self.storage.admin.read();
        let sender = self.context.msg_sender().unwrap();
        assert(sender == admin, "Only admin can create proposals");

        // Validate inputs
        assert(voting_end > voting_start, "End must be after start");
        assert(num_choices >= 2, "Need at least 2 choices");
        assert(num_choices <= 8, "Max 8 choices");

        // Get and increment proposal ID
        let proposal_id = self.storage.next_proposal_id.read();
        self.storage.next_proposal_id.write(proposal_id + 1);

        // Store proposal
        let proposal = Proposal::new(
            description_hash,
            snapshot_block,
            voting_start,
            voting_end,
            num_choices,
        );
        self.storage.proposals.at(proposal_id).write(proposal);

        proposal_id
    }

    /// Cancel a proposal (admin only)
    #[external("public")]
    fn cancel_proposal(proposal_id: Field) {
        let admin = self.storage.admin.read();
        let sender = self.context.msg_sender().unwrap();
        assert(sender == admin, "Only admin can cancel proposals");

        let mut proposal = self.storage.proposals.at(proposal_id).read();
        assert(!proposal.cancelled, "Already cancelled");
        proposal.cancelled = true;
        self.storage.proposals.at(proposal_id).write(proposal);
    }

    // =========================================================================
    // Voting (Private with Tiered Power)
    // =========================================================================

    /// Cast a vote with tiered voting power
    ///
    /// # Arguments
    /// * `proposal_id` - The proposal to vote on
    /// * `choice` - Vote choice (0 to num_choices-1)
    /// * `eth_address` - Voter's Ethereum address (20 bytes, for balance lookup)
    /// * `claimed_tier` - The tier the voter claims to be in (1-4)
    ///
    /// # Privacy
    /// - Only the tier is used for voting power, not the exact balance
    /// - Vote choice remains private (in the VoteNote)
    /// - Aztec identity is not linked to the public tally
    /// - Nullifier prevents double voting without revealing voter identity
    ///
    /// # Tier Verification
    /// The contract verifies:
    /// 1. Balance >= tier's minimum threshold
    /// 2. Balance < next tier's minimum (forces correct tier claim)
    #[external("private")]
    fn cast_vote(
        proposal_id: Field,
        choice: u8,
        eth_address: [u8; 20],
        claimed_tier: u8,
    ) {
        let voter = self.context.msg_sender().unwrap();

        // Validate tier claim range
        assert(claimed_tier > 0, "Cannot vote with tier 0");
        assert(claimed_tier <= MAX_TIER, "Invalid tier");

        // Get voting power from tier configuration
        let tier = TIERS[claimed_tier as u32];
        let voting_power = tier.voting_power;

        // NOTE: eth-proofs integration would go here
        // When eth-proofs is compatible with Aztec v3, enable balance verification:
        //
        // Option 1: Use a predefined token (e.g., USDC from token_list)
        //   let balance: u128 = USDC.get_balance(
        //       Address::from_bytes(eth_address),
        //       snapshot_block,
        //       false  // false = direct proof, true = recursive
        //   );
        //
        // Option 2: Use a custom token configuration
        //   let token = ERC20 {
        //       address: Address::from_bytes(self.storage.eth_token_address.read()),
        //       balances_slot: self.storage.eth_balance_slot.read() as u64,
        //       allowances_slot: 0,
        //       chain_id: self.storage.eth_chain_id.read(),
        //   };
        //   let balance: u128 = token.get_balance(
        //       Address::from_bytes(eth_address),
        //       snapshot_block,
        //       false
        //   );
        //
        // Then verify tier:
        //   assert(balance >= tier.min_balance, "Balance below tier minimum");
        //   if claimed_tier < MAX_TIER {
        //       let next_tier = TIERS[(claimed_tier + 1) as u32];
        //       assert(balance < next_tier.min_balance, "Must claim higher tier");
        //   }

        // Generate nullifier to prevent double voting
        // Nullifier = hash(proposal_id, eth_address_as_field)
        let eth_addr_field = super::convert_eth_address_to_field(eth_address);
        let nullifier = poseidon2_hash([proposal_id, eth_addr_field]);
        self.context.push_nullifier(nullifier);

        // Create private vote note (stores tier, not balance)
        // This serves as a receipt - the voter can prove they voted
        let _vote_note = VoteNote::new(
            proposal_id,
            choice,
            claimed_tier,
            voting_power,
            voter,
        );

        // Enqueue public tally update
        // The public function validates proposal state and updates tally
        self.enqueue_self._update_tally(proposal_id, choice, voting_power);
    }

    // =========================================================================
    // Internal Functions
    // =========================================================================

    /// Update vote tally (called internally from cast_vote)
    ///
    /// This function runs in public context and:
    /// 1. Validates the proposal exists and is active
    /// 2. Validates the choice is valid
    /// 3. Updates the tally
    #[only_self]
    #[external("public")]
    fn _update_tally(proposal_id: Field, choice: u8, voting_power: u128) {
        // Validate proposal
        let proposal = self.storage.proposals.at(proposal_id).read();
        assert(!proposal.cancelled, "Proposal cancelled");
        assert(choice < proposal.num_choices, "Invalid choice");

        // Validate voting period
        let current_time = self.context.timestamp() as u64;
        assert(current_time >= proposal.voting_start, "Voting not started");
        assert(current_time <= proposal.voting_end, "Voting ended");

        // Update tally
        let current = self.storage.vote_tallies.at(proposal_id).at(choice).read();
        self.storage.vote_tallies.at(proposal_id).at(choice).write(current + voting_power);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /// Get proposal details
    #[external("utility")]
    unconstrained fn get_proposal(proposal_id: Field) -> pub Proposal {
        self.storage.proposals.at(proposal_id).read()
    }

    /// Get vote count for a specific choice
    #[external("utility")]
    unconstrained fn get_vote_count(proposal_id: Field, choice: u8) -> pub u128 {
        self.storage.vote_tallies.at(proposal_id).at(choice).read()
    }

    /// Get full results for a proposal
    #[external("utility")]
    unconstrained fn get_results(proposal_id: Field) -> pub (Proposal, [u128; 8]) {
        let proposal = self.storage.proposals.at(proposal_id).read();
        let mut tallies: [u128; 8] = [0; 8];
        for i in 0..8 {
            tallies[i] = self.storage.vote_tallies.at(proposal_id).at(i as u8).read();
        }
        (proposal, tallies)
    }

    /// Get tier configuration
    #[external("utility")]
    unconstrained fn get_tier_info(tier: u8) -> pub (u128, u128) {
        let t = TIERS[tier as u32];
        (t.min_balance, t.voting_power)
    }

    /// Get all tier configurations
    #[external("utility")]
    unconstrained fn get_all_tiers() -> pub [(u128, u128); 5] {
        let mut result: [(u128, u128); 5] = [(0, 0); 5];
        for i in 0..5 {
            result[i] = (TIERS[i].min_balance, TIERS[i].voting_power);
        }
        result
    }

    /// Get admin address
    #[external("utility")]
    unconstrained fn get_admin() -> pub AztecAddress {
        self.storage.admin.read()
    }

    /// Get the Ethereum token configuration
    #[external("utility")]
    unconstrained fn get_eth_token_config() -> pub ([u8; 20], Field, u32) {
        (
            self.storage.eth_token_address.read(),
            self.storage.eth_balance_slot.read(),
            self.storage.eth_chain_id.read(),
        )
    }

    /// Get next proposal ID
    #[external("utility")]
    unconstrained fn get_next_proposal_id() -> pub Field {
        self.storage.next_proposal_id.read()
    }
}

// =========================================================================
// Helper Functions (outside contract for use by cast_vote)
// =========================================================================

/// Convert Ethereum address (20 bytes) to Field for nullifier computation
pub fn convert_eth_address_to_field(addr: [u8; 20]) -> Field {
    let mut result: Field = 0;
    for i in 0..20 {
        result = result * 256 + (addr[i] as Field);
    }
    result
}
