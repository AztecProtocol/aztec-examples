/**
 * Integration tests for the PredictionMarketZkTLS contract.
 *
 * Tests the complete-set model with real token collateral:
 * - Contract deployment and token linking
 * - mint_sets: deposit collateral, receive YES + NO shares
 * - burn_sets: return YES + NO shares, receive collateral
 * - zkTLS resolution (requires testdata/attestation.json)
 * - redeem: burn winning shares, receive collateral
 * - Guard rails (double resolution, burn after resolve, etc.)
 */

import { describe, expect, test, beforeAll, afterAll } from "vitest";
import type { FieldLike } from "@aztec/aztec.js/abi";
import { TxExecutionResult } from "@aztec/aztec.js/tx";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import fs from "fs";

import { PredictionMarketZkTLSContract } from "../artifacts/PredictionMarketZkTLS.js";
import { TokenContract } from "../artifacts/Token.js";
import { getSponsoredFPCInstance } from "../scripts/sponsored_fpc.js";
import {
  parseAttestationFile,
  DEFAULT_ALLOWED_URLS,
} from "../scripts/parse_attestation.js";
import { computeAllowedUrlHashes } from "../scripts/compute_url_hashes.js";

const NODE_URL = "http://localhost:8080";
const TEST_TIMEOUT = 600_000;
const ATTESTATION_PATH = "testdata/attestation.json";

// Threshold: $50,000.00 = 5000000 cents (BTC is well above this)
const PRICE_THRESHOLD = 5000000n;
const THRESHOLD_ABOVE = true; // YES wins if price >= threshold
const MINT_AMOUNT = 10000n; // tokens minted to each user
const SET_AMOUNT = 3000n; // complete sets to mint

function hasAttestation(): boolean {
  return fs.existsSync(ATTESTATION_PATH);
}

describe("PredictionMarketZkTLS - Complete Set Model", () => {
  let wallet: EmbeddedWallet;
  let adminAddress: AztecAddress;
  let aliceAddress: AztecAddress;
  let bobAddress: AztecAddress;
  let market: PredictionMarketZkTLSContract;
  let token: TokenContract;
  let paymentMethod: SponsoredFeePaymentMethod;
  let urlHashes: string[];
  let expiry: bigint;

  beforeAll(async () => {
    console.log(`Connecting to Aztec node at ${NODE_URL}`);
    const aztecNode = await createAztecNodeClient(NODE_URL);

    const sponsoredFPC = await getSponsoredFPCInstance();
    paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

    wallet = await EmbeddedWallet.create(aztecNode, { ephemeral: true });
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact);

    // Create 3 accounts: admin, Alice, Bob
    console.log("Creating accounts...");
    for (let i = 0; i < 3; i++) {
      const mgr = await wallet.createSchnorrAccount(Fr.random(), Fr.random());
      await (await mgr.getDeployMethod()).send({
        from: NO_FROM,
        fee: { paymentMethod },
      });
    }

    const accounts = await wallet.getAccounts();
    adminAddress = accounts[0].item;
    aliceAddress = accounts[1].item;
    bobAddress = accounts[2].item;
    console.log(`Admin: ${adminAddress}`);
    console.log(`Alice: ${aliceAddress}`);
    console.log(`Bob:   ${bobAddress}`);

    urlHashes = await computeAllowedUrlHashes(DEFAULT_ALLOWED_URLS);

    // Set expiry 5 minutes from now
    expiry = BigInt(Math.floor(Date.now() / 1000) + 300);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (wallet) await wallet.stop();
  });

  // ===== DEPLOYMENT =====

  test(
    "should deploy market and token contracts",
    async () => {
      const sendOpts = { from: adminAddress, fee: { paymentMethod } };

      // Deploy prediction market
      ({ contract: market } = await PredictionMarketZkTLSContract.deploy(
        wallet,
        adminAddress,
        expiry,
        PRICE_THRESHOLD,
        THRESHOLD_ABOVE,
        urlHashes as unknown as FieldLike[],
      ).send(sendOpts));

      expect(market.address).toBeDefined();
      console.log(`Market: ${market.address}`);

      // Deploy Token with admin as minter (same pattern as zktls-airdrop)
      ({ contract: token } = await TokenContract.deployWithOpts<"constructor_with_minter">(
        { method: "constructor_with_minter", wallet },
        "Prediction Collateral",
        "PCOL",
        18,
        adminAddress, // minter = admin
      ).send(sendOpts));

      expect(token.address).toBeDefined();
      console.log(`Token: ${token.address}`);

      // Link market -> token
      await market.methods.set_token(token.address).send(sendOpts);
      console.log("Linked market -> token");

      // Mint tokens to Alice and Bob via mint_to_private (admin is minter)
      await token.methods
        .mint_to_private(aliceAddress, MINT_AMOUNT)
        .send(sendOpts);
      await token.methods
        .mint_to_private(bobAddress, MINT_AMOUNT)
        .send(sendOpts);
      console.log(`Minted ${MINT_AMOUNT} tokens each to Alice and Bob`);
    },
    TEST_TIMEOUT,
  );

  test(
    "should reject set_token called twice",
    async () => {
      const sendOpts = { from: adminAddress, fee: { paymentMethod } };
      await expect(
        market.methods.set_token(token.address).send(sendOpts),
      ).rejects.toThrow();
      console.log("Double set_token correctly rejected");
    },
    TEST_TIMEOUT,
  );

  // ===== COMPLETE SET OPERATIONS =====

  test(
    "alice mints complete sets (deposits collateral, gets YES + NO)",
    async () => {
      const sendOpts = { from: aliceAddress, fee: { paymentMethod } };

      // Create auth witness allowing market contract to transfer Alice's tokens
      const nonce = Fr.random();
      const witness = await wallet.createAuthWit(aliceAddress, {
        caller: market.address,
        action: token.methods.transfer_private_to_public(
          aliceAddress,
          market.address,
          SET_AMOUNT,
          nonce,
        ),
      });
      // Mint complete sets (pass auth witness in send options)
      const { receipt } = await market.methods
        .mint_sets(SET_AMOUNT, nonce)
        .send({ ...sendOpts, authWitnesses: [witness] });
      expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);

      // Check YES and NO balances
      const { result: yesBalance } = await market.methods
        .get_yes_balance(aliceAddress)
        .simulate({ from: aliceAddress });
      const { result: noBalance } = await market.methods
        .get_no_balance(aliceAddress)
        .simulate({ from: aliceAddress });

      expect(yesBalance).toBe(SET_AMOUNT);
      expect(noBalance).toBe(SET_AMOUNT);

      // Check total sets
      const { result: totalSets } = await market.methods
        .get_total_sets()
        .simulate({ from: adminAddress });
      expect(totalSets).toBe(SET_AMOUNT);

      console.log(`Alice minted ${SET_AMOUNT} sets. YES=${yesBalance}, NO=${noBalance}`);
    },
    TEST_TIMEOUT,
  );

  test(
    "bob mints complete sets",
    async () => {
      const sendOpts = { from: bobAddress, fee: { paymentMethod } };

      const nonce = Fr.random();
      const witness = await wallet.createAuthWit(bobAddress, {
        caller: market.address,
        action: token.methods.transfer_private_to_public(
          bobAddress,
          market.address,
          SET_AMOUNT,
          nonce,
        ),
      });
      const { receipt } = await market.methods
        .mint_sets(SET_AMOUNT, nonce)
        .send({ ...sendOpts, authWitnesses: [witness] });
      expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);

      const { result: totalSets } = await market.methods
        .get_total_sets()
        .simulate({ from: adminAddress });
      expect(totalSets).toBe(SET_AMOUNT * 2n);

      console.log(`Bob minted ${SET_AMOUNT} sets. Total: ${totalSets}`);
    },
    TEST_TIMEOUT,
  );

  test(
    "alice burns some complete sets (returns collateral)",
    async () => {
      const burnAmount = 1000n;
      const sendOpts = { from: aliceAddress, fee: { paymentMethod } };

      const { receipt } = await market.methods
        .burn_sets(burnAmount)
        .send(sendOpts);
      expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);

      const { result: yesBalance } = await market.methods
        .get_yes_balance(aliceAddress)
        .simulate({ from: aliceAddress });
      expect(yesBalance).toBe(SET_AMOUNT - burnAmount);

      const { result: noBalance } = await market.methods
        .get_no_balance(aliceAddress)
        .simulate({ from: aliceAddress });
      expect(noBalance).toBe(SET_AMOUNT - burnAmount);

      console.log(`Alice burned ${burnAmount} sets. YES=${yesBalance}, NO=${noBalance}`);
    },
    TEST_TIMEOUT,
  );

  // ===== PRE-RESOLUTION GUARDS =====

  test(
    "should reject redemption before resolution",
    async () => {
      const sendOpts = { from: aliceAddress, fee: { paymentMethod } };
      await expect(
        market.methods.redeem(100n).send(sendOpts),
      ).rejects.toThrow();
      console.log("Pre-resolution redemption correctly rejected");
    },
    TEST_TIMEOUT,
  );

  // ===== zkTLS RESOLUTION =====

  test(
    "should resolve market with valid zkTLS attestation",
    async () => {
      if (!hasAttestation()) {
        console.log("Skipping: no attestation file.");
        return;
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const waitSec = Number(expiry) - nowSec;
      if (waitSec > 0) {
        console.log(`Waiting ${waitSec}s for market expiry...`);
        await new Promise((r) => setTimeout(r, (waitSec + 5) * 1000));
      }

      const parsed = parseAttestationFile(ATTESTATION_PATH, DEFAULT_ALLOWED_URLS);
      const sendOpts = { from: adminAddress, fee: { paymentMethod } };

      const { receipt } = await market.methods
        .resolve_market(
          parsed.publicKeyX as unknown as FieldLike[],
          parsed.publicKeyY as unknown as FieldLike[],
          parsed.hash as unknown as FieldLike[],
          parsed.signature as unknown as FieldLike[],
          parsed.requestUrls as unknown as FieldLike[][],
          parsed.allowedUrls as unknown as FieldLike[][],
          parsed.dataHashes as unknown as FieldLike[][],
          parsed.contents as unknown as FieldLike[][],
        )
        .send(sendOpts);

      expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);

      const { result: resolved } = await market.methods
        .is_resolved()
        .simulate({ from: adminAddress });
      expect(resolved).toBe(true);

      const { result: outcomeIsYes } = await market.methods
        .get_resolution_outcome()
        .simulate({ from: adminAddress });
      const { result: resolvedPrice } = await market.methods
        .get_resolution_price()
        .simulate({ from: adminAddress });
      console.log(
        `Resolved: outcome=${outcomeIsYes ? "YES" : "NO"}, price=$${Number(resolvedPrice) / 100}`,
      );
    },
    TEST_TIMEOUT,
  );

  test(
    "should reject double resolution",
    async () => {
      if (!hasAttestation()) {
        console.log("Skipping: no attestation file.");
        return;
      }

      const parsed = parseAttestationFile(ATTESTATION_PATH, DEFAULT_ALLOWED_URLS);
      const sendOpts = { from: adminAddress, fee: { paymentMethod } };

      await expect(
        market.methods
          .resolve_market(
            parsed.publicKeyX as unknown as FieldLike[],
            parsed.publicKeyY as unknown as FieldLike[],
            parsed.hash as unknown as FieldLike[],
            parsed.signature as unknown as FieldLike[],
            parsed.requestUrls as unknown as FieldLike[][],
            parsed.allowedUrls as unknown as FieldLike[][],
            parsed.dataHashes as unknown as FieldLike[][],
            parsed.contents as unknown as FieldLike[][],
          )
          .send(sendOpts),
      ).rejects.toThrow();

      console.log("Double resolution correctly rejected");
    },
    TEST_TIMEOUT,
  );

  // ===== SETTLEMENT =====

  test(
    "winner redeems shares for collateral tokens",
    async () => {
      if (!hasAttestation()) {
        console.log("Skipping: no attestation file.");
        return;
      }

      const { result: outcomeIsYes } = await market.methods
        .get_resolution_outcome()
        .simulate({ from: adminAddress });

      // Alice has SET_AMOUNT - 1000 of each (burned 1000 complete sets)
      const aliceWinningShares = SET_AMOUNT - 1000n;
      const sendOpts = { from: aliceAddress, fee: { paymentMethod } };

      const { receipt } = await market.methods
        .redeem(aliceWinningShares)
        .send(sendOpts);
      expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);

      // Winning shares should be 0
      const balanceMethod = outcomeIsYes
        ? market.methods.get_yes_balance
        : market.methods.get_no_balance;
      const { result: sharesAfter } = await balanceMethod(aliceAddress)
        .simulate({ from: aliceAddress });
      expect(sharesAfter).toBe(0n);

      // Check Alice got collateral tokens back (private balance)
      const { result: tokenBalance } = await token.methods
        .balance_of_private(aliceAddress)
        .simulate({ from: aliceAddress });
      expect(tokenBalance).toBeGreaterThan(0n);

      console.log(`Alice redeemed ${aliceWinningShares} winning shares. Token balance: ${tokenBalance}`);
    },
    TEST_TIMEOUT,
  );

  test(
    "burn_sets still works after resolution",
    async () => {
      if (!hasAttestation()) {
        console.log("Skipping: no attestation file.");
        return;
      }

      // Bob holds complete sets. He can burn them regardless of outcome.
      const { result: yesBalance } = await market.methods
        .get_yes_balance(bobAddress)
        .simulate({ from: bobAddress });
      const { result: noBalance } = await market.methods
        .get_no_balance(bobAddress)
        .simulate({ from: bobAddress });

      const burnAmount = yesBalance < noBalance ? yesBalance : noBalance;
      if (burnAmount > 0n) {
        const sendOpts = { from: bobAddress, fee: { paymentMethod } };
        const { receipt } = await market.methods
          .burn_sets(burnAmount)
          .send(sendOpts);
        expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);
        console.log(`Bob burned ${burnAmount} complete sets after resolution`);
      } else {
        console.log("Bob has no complete sets to burn");
      }
    },
    TEST_TIMEOUT,
  );
});
