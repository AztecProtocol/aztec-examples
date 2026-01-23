use aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

/// Voting tier configuration
/// Each tier has a minimum balance threshold and fixed voting power
#[derive(Eq, Serialize, Deserialize)]
pub struct VotingTier {
    pub min_balance: u128,
    pub voting_power: u128,
}

/// Default tier configuration
/// Tiers provide k-anonymity: users in the same tier are indistinguishable
///
/// | Tier | Balance Range    | Voting Power |
/// |------|------------------|--------------|
/// | 0    | 0 (no tokens)    | 0            |
/// | 1    | 1 - 999          | 1            |
/// | 2    | 1,000 - 9,999    | 5            |
/// | 3    | 10,000 - 99,999  | 25           |
/// | 4    | 100,000+         | 100          |
pub global TIERS: [VotingTier; 5] = [
    VotingTier { min_balance: 0, voting_power: 0 },           // Tier 0: No tokens
    VotingTier { min_balance: 1, voting_power: 1 },           // Tier 1: 1-999
    VotingTier { min_balance: 1_000, voting_power: 5 },       // Tier 2: 1k-9.9k
    VotingTier { min_balance: 10_000, voting_power: 25 },     // Tier 3: 10k-99.9k
    VotingTier { min_balance: 100_000, voting_power: 100 },   // Tier 4: 100k+
];

pub global NUM_TIERS: u8 = 5;
pub global MAX_TIER: u8 = 4;

/// Proposal data stored publicly
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct Proposal {
    /// Hash of the proposal description (stored off-chain)
    pub description_hash: Field,
    /// Ethereum block number for balance snapshot
    pub snapshot_block: u64,
    /// Unix timestamp when voting starts
    pub voting_start: u64,
    /// Unix timestamp when voting ends
    pub voting_end: u64,
    /// Number of choices (2-8)
    pub num_choices: u8,
    /// Whether the proposal has been cancelled
    pub cancelled: bool,
}

impl Proposal {
    pub fn new(
        description_hash: Field,
        snapshot_block: u64,
        voting_start: u64,
        voting_end: u64,
        num_choices: u8,
    ) -> Self {
        Proposal {
            description_hash,
            snapshot_block,
            voting_start,
            voting_end,
            num_choices,
            cancelled: false,
        }
    }

    pub fn is_active(self, current_time: u64) -> bool {
        !self.cancelled
            & (current_time >= self.voting_start)
            & (current_time <= self.voting_end)
    }
}

/// Get the tier index for a given balance
/// Returns the highest tier the balance qualifies for
pub fn get_tier_for_balance(balance: u128) -> u8 {
    let mut tier_idx: u8 = 0;
    for i in 0..5 {
        if balance >= TIERS[i].min_balance {
            tier_idx = i as u8;
        }
    }
    tier_idx
}

/// Verify that a claimed tier is valid for the given balance
/// Returns true if balance falls within the claimed tier's range
pub fn verify_tier_claim(balance: u128, claimed_tier: u8) -> bool {
    if claimed_tier == 0 {
        // Tier 0 is only valid for zero balance
        balance == 0
    } else if claimed_tier > MAX_TIER {
        // Invalid tier
        false
    } else {
        let tier = TIERS[claimed_tier as u32];
        let above_min = balance >= tier.min_balance;

        // Check if below next tier's minimum (unless max tier)
        let below_next = if claimed_tier < MAX_TIER {
            let next_tier = TIERS[(claimed_tier + 1) as u32];
            balance < next_tier.min_balance
        } else {
            true
        };

        above_min & below_next
    }
}
