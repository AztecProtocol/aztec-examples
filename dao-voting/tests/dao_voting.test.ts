import {
  AccountWallet,
  createLogger,
  Fr,
  PXE,
  waitForPXE,
  createPXEClient,
  Logger,
} from "@aztec/aztec.js";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { DaoVotingContract } from "../artifacts/DaoVoting.js";

const PXE_URL = process.env.PXE_URL || "http://localhost:8080";

describe("DAO Voting with Tiered Power", () => {
  let pxe: PXE;
  let logger: Logger;
  let admin: AccountWallet;
  let voter1: AccountWallet;
  let voter2: AccountWallet;
  let contract: DaoVotingContract;

  // Mock ETH token address (e.g., USDC on mainnet)
  const ETH_TOKEN_ADDRESS = new Uint8Array(20).fill(0);
  const ETH_BALANCE_SLOT = new Fr(9n); // USDC balance slot
  const ETH_CHAIN_ID = 1;

  beforeAll(async () => {
    logger = createLogger("dao-voting:test");
    logger.info("Connecting to PXE...");

    pxe = await createPXEClient(PXE_URL);
    await waitForPXE(pxe);

    logger.info("Creating test accounts...");

    // Create admin account
    const adminSecret = Fr.random();
    const adminAccount = await getSchnorrAccount(pxe, adminSecret, Fr.random());
    admin = await adminAccount.waitSetup();

    // Create voter accounts
    const voter1Secret = Fr.random();
    const voter1Account = await getSchnorrAccount(pxe, voter1Secret, Fr.random());
    voter1 = await voter1Account.waitSetup();

    const voter2Secret = Fr.random();
    const voter2Account = await getSchnorrAccount(pxe, voter2Secret, Fr.random());
    voter2 = await voter2Account.waitSetup();

    logger.info("Accounts created successfully");
  }, 120000);

  describe("Contract Deployment", () => {
    test("should deploy contract with tier configuration", async () => {
      logger.info("Deploying DaoVoting contract...");

      contract = await DaoVotingContract.deploy(
        admin,
        admin.getAddress(),
        ETH_TOKEN_ADDRESS,
        ETH_BALANCE_SLOT,
        ETH_CHAIN_ID
      )
        .send()
        .deployed();

      logger.info(`Contract deployed at: ${contract.address}`);

      // Verify admin
      const contractAdmin = await contract.methods.get_admin().simulate();
      expect(contractAdmin.toString()).toBe(admin.getAddress().toString());
    }, 120000);

    test("should have correct tier configuration", async () => {
      // Verify tier 2 (1,000 - 9,999 tokens -> 5 voting power)
      const [minBalance, votingPower] = await contract.methods
        .get_tier_info(2)
        .simulate();

      expect(minBalance).toBe(1000n);
      expect(votingPower).toBe(5n);
    });

    test("should return all tiers", async () => {
      const tiers = await contract.methods.get_all_tiers().simulate();

      // Tier 0: 0 tokens -> 0 power
      expect(tiers[0][0]).toBe(0n);
      expect(tiers[0][1]).toBe(0n);

      // Tier 1: 1 token -> 1 power
      expect(tiers[1][0]).toBe(1n);
      expect(tiers[1][1]).toBe(1n);

      // Tier 4: 100,000 tokens -> 100 power
      expect(tiers[4][0]).toBe(100000n);
      expect(tiers[4][1]).toBe(100n);
    });
  });

  describe("Proposal Management", () => {
    let proposalId: bigint;

    test("should create proposal", async () => {
      const descriptionHash = Fr.random();
      const snapshotBlock = 18000000n; // Ethereum block number
      const now = BigInt(Math.floor(Date.now() / 1000));
      const votingStart = now;
      const votingEnd = now + 86400n; // 1 day
      const numChoices = 3;

      const receipt = await contract.methods
        .create_proposal(
          descriptionHash,
          snapshotBlock,
          votingStart,
          votingEnd,
          numChoices
        )
        .send()
        .wait();

      // Get the proposal ID from the return value
      proposalId = 1n; // First proposal

      const proposal = await contract.methods.get_proposal(proposalId).simulate();
      expect(proposal.num_choices).toBe(numChoices);
      expect(proposal.cancelled).toBe(false);
    }, 120000);

    test("should reject proposal creation from non-admin", async () => {
      const descriptionHash = Fr.random();
      const now = BigInt(Math.floor(Date.now() / 1000));

      await expect(
        contract
          .withWallet(voter1)
          .methods.create_proposal(descriptionHash, 18000000n, now, now + 86400n, 2)
          .send()
          .wait()
      ).rejects.toThrow();
    }, 60000);

    test("should cancel proposal", async () => {
      // Create a proposal to cancel
      const descriptionHash = Fr.random();
      const now = BigInt(Math.floor(Date.now() / 1000));

      await contract.methods
        .create_proposal(descriptionHash, 18000000n, now, now + 86400n, 2)
        .send()
        .wait();

      const cancelProposalId = 2n;

      await contract.methods.cancel_proposal(cancelProposalId).send().wait();

      const proposal = await contract.methods
        .get_proposal(cancelProposalId)
        .simulate();
      expect(proposal.cancelled).toBe(true);
    }, 120000);
  });

  describe("Voting", () => {
    let votingProposalId: bigint;
    const voter1EthAddress = new Uint8Array(20);
    const voter2EthAddress = new Uint8Array(20);

    beforeAll(() => {
      // Set up unique ETH addresses for voters
      voter1EthAddress[19] = 1;
      voter2EthAddress[19] = 2;
    });

    test("should create proposal for voting tests", async () => {
      const descriptionHash = Fr.random();
      const snapshotBlock = 18000000n;
      const now = BigInt(Math.floor(Date.now() / 1000));
      const votingStart = now - 60n; // Started 1 minute ago
      const votingEnd = now + 86400n; // Ends in 1 day

      await contract.methods
        .create_proposal(descriptionHash, snapshotBlock, votingStart, votingEnd, 3)
        .send()
        .wait();

      votingProposalId = 3n;
    }, 120000);

    test("should cast vote with tier 2", async () => {
      // Voter claims tier 2 (1,000-9,999 tokens -> 5 voting power)
      await contract
        .withWallet(voter1)
        .methods.cast_vote(
          votingProposalId,
          0, // choice A
          voter1EthAddress,
          2 // tier 2
        )
        .send()
        .wait();

      // Verify tally increased by tier 2's voting power (5)
      const voteCount = await contract.methods
        .get_vote_count(votingProposalId, 0)
        .simulate();
      expect(voteCount).toBe(5n);
    }, 120000);

    test("should prevent double voting with same ETH address", async () => {
      // Same eth_address voting twice should fail (nullifier exists)
      await expect(
        contract
          .withWallet(voter1)
          .methods.cast_vote(votingProposalId, 1, voter1EthAddress, 2)
          .send()
          .wait()
      ).rejects.toThrow();
    }, 60000);

    test("should allow different ETH address to vote", async () => {
      // Different ETH address can vote
      await contract
        .withWallet(voter2)
        .methods.cast_vote(
          votingProposalId,
          1, // choice B
          voter2EthAddress,
          3 // tier 3 (25 voting power)
        )
        .send()
        .wait();

      // Verify tallies
      const choiceACount = await contract.methods
        .get_vote_count(votingProposalId, 0)
        .simulate();
      const choiceBCount = await contract.methods
        .get_vote_count(votingProposalId, 1)
        .simulate();

      expect(choiceACount).toBe(5n); // Tier 2
      expect(choiceBCount).toBe(25n); // Tier 3
    }, 120000);

    test("should get full results", async () => {
      const [proposal, tallies] = await contract.methods
        .get_results(votingProposalId)
        .simulate();

      expect(proposal.num_choices).toBe(3);
      expect(tallies[0]).toBe(5n); // Choice A: tier 2 = 5
      expect(tallies[1]).toBe(25n); // Choice B: tier 3 = 25
      expect(tallies[2]).toBe(0n); // Choice C: no votes
    });
  });

  describe("Tier Privacy (k-anonymity)", () => {
    test("voters in same tier contribute identical power", async () => {
      // This test demonstrates that two voters with different balances
      // in the same tier (e.g., 1,500 tokens vs 8,000 tokens)
      // both contribute exactly 5 voting power (tier 2).
      //
      // Without eth-proofs integration, we can't verify actual balances,
      // but the contract structure ensures this property holds.
      //
      // The privacy guarantee: an observer cannot distinguish between
      // a voter with 1,500 tokens and one with 8,000 tokens based on
      // their voting power contribution alone.

      const tiers = await contract.methods.get_all_tiers().simulate();

      // All tier 2 voters get exactly 5 power, regardless of actual balance
      expect(tiers[2][1]).toBe(5n);

      // This is the k-anonymity property: within a tier,
      // all voters are indistinguishable
    });
  });
});
