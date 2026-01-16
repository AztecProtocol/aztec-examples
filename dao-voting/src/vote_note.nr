use aztec::{
    macros::notes::note,
    oracle::random::random,
    protocol_types::{address::AztecAddress, traits::{Deserialize, Packable, Serialize}},
};

/// Private vote note - stores tier, NOT exact balance
///
/// This note serves as a receipt of the vote. The key privacy feature is that
/// it stores the voter's tier rather than their exact balance, providing
/// k-anonymity within each tier.
///
/// Note: For minimal implementation, this note may not need to be stored
/// since the nullifier prevents double voting and the tally is updated publicly.
/// However, storing it allows voters to prove they voted if needed.
#[derive(Eq, Serialize, Deserialize, Packable)]
#[note]
pub struct VoteNote {
    /// Proposal being voted on
    proposal_id: Field,
    /// Vote choice (0 to num_choices-1)
    choice: u8,
    /// Voter's tier (determines voting power, NOT exact balance)
    tier: u8,
    /// Voting power (derived from tier, stored for convenience)
    voting_power: u128,
    /// Owner of this note (the voter's Aztec address)
    owner: AztecAddress,
    /// Randomness for note privacy
    randomness: Field,
}

impl VoteNote {
    pub fn new(
        proposal_id: Field,
        choice: u8,
        tier: u8,
        voting_power: u128,
        owner: AztecAddress,
    ) -> Self {
        // Safety: randomness is used for privacy, not security.
        // It prevents brute-forcing note contents.
        let randomness = unsafe { random() };
        VoteNote {
            proposal_id,
            choice,
            tier,
            voting_power,
            owner,
            randomness,
        }
    }

    pub fn get_proposal_id(self) -> Field {
        self.proposal_id
    }

    pub fn get_choice(self) -> u8 {
        self.choice
    }

    pub fn get_tier(self) -> u8 {
        self.tier
    }

    pub fn get_voting_power(self) -> u128 {
        self.voting_power
    }

    pub fn get_owner(self) -> AztecAddress {
        self.owner
    }
}
