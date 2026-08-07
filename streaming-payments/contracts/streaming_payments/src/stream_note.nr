use aztec::{
    macros::notes::note,
    oracle::random::random,
    protocol_types::{address::AztecAddress, traits::{Deserialize, Packable, Serialize}},
};

/// A note representing a token stream from sender to recipient.
/// Tokens unlock linearly from start_time to end_time, with an optional cliff.
#[derive(Eq, Serialize, Deserialize, Packable)]
#[note]
pub struct StreamNote {
    /// Unique identifier for this stream
    stream_id: Field,
    /// Address that created the stream and can cancel it
    sender: AztecAddress,
    /// Total tokens to be streamed
    total_amount: u128,
    /// Unix timestamp when streaming starts
    start_time: u64,
    /// Unix timestamp when streaming ends (fully vested)
    end_time: u64,
    /// Unix timestamp before which no tokens can be withdrawn
    cliff_time: u64,
    /// Amount already claimed by recipient
    claimed_amount: u128,
    /// Owner of this note (the recipient)
    owner: AztecAddress,
    /// Randomness for privacy
    randomness: Field,
}

impl StreamNote {
    pub fn new(
        stream_id: Field,
        sender: AztecAddress,
        recipient: AztecAddress,
        total_amount: u128,
        start_time: u64,
        end_time: u64,
        cliff_time: u64,
    ) -> Self {
        // Safety: randomness protects recipient privacy from brute-forcing.
        // Sender already knows the note contents, so they're trusted to not disclose.
        let randomness = unsafe { random() };
        StreamNote {
            stream_id,
            sender,
            total_amount,
            start_time,
            end_time,
            cliff_time,
            claimed_amount: 0,
            owner: recipient,
            randomness,
        }
    }

    pub fn get_stream_id(self) -> Field {
        self.stream_id
    }

    pub fn get_sender(self) -> AztecAddress {
        self.sender
    }

    pub fn get_total_amount(self) -> u128 {
        self.total_amount
    }

    pub fn get_start_time(self) -> u64 {
        self.start_time
    }

    pub fn get_end_time(self) -> u64 {
        self.end_time
    }

    pub fn get_cliff_time(self) -> u64 {
        self.cliff_time
    }

    pub fn get_claimed_amount(self) -> u128 {
        self.claimed_amount
    }

    pub fn get_owner(self) -> AztecAddress {
        self.owner
    }

    /// Calculate how many tokens are unlocked at the given timestamp
    pub fn compute_unlocked(self, current_time: u64) -> u128 {
        // Before cliff, nothing is unlocked
        if current_time < self.cliff_time {
            0
        } else if current_time >= self.end_time {
            // After end time, everything is unlocked
            self.total_amount
        } else {
            // Linear vesting between start and end
            let elapsed = current_time - self.start_time;
            let duration = self.end_time - self.start_time;
            // Linear interpolation: (total_amount * elapsed) / duration
            (self.total_amount * (elapsed as u128)) / (duration as u128)
        }
    }

    /// Calculate how many tokens can be withdrawn (unlocked minus already claimed)
    pub fn compute_withdrawable(self, current_time: u64) -> u128 {
        let unlocked = self.compute_unlocked(current_time);
        if unlocked > self.claimed_amount {
            unlocked - self.claimed_amount
        } else {
            0
        }
    }

    /// Create an updated note with new claimed amount
    pub fn with_claimed(self, new_claimed_amount: u128) -> Self {
        StreamNote {
            stream_id: self.stream_id,
            sender: self.sender,
            total_amount: self.total_amount,
            start_time: self.start_time,
            end_time: self.end_time,
            cliff_time: self.cliff_time,
            claimed_amount: new_claimed_amount,
            owner: self.owner,
            randomness: self.randomness,
        }
    }
}
