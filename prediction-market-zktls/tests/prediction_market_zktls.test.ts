/**
 * Integration tests for the PredictionMarketZkTLS contract.
 *
 * Tests cover:
 * - Market deployment and configuration
 * - Private betting (deposit, buy YES/NO)
 * - Price mechanics (CSMM pricing)
 * - zkTLS resolution (requires testdata/attestation.json)
 * - Private settlement (redeem winning shares)
 * - Guard rails (double resolution, betting after resolve, etc.)
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
import { getSponsoredFPCInstance } from "../scripts/sponsored_fpc.js";
import {
  parseAttestationFile,
  DEFAULT_ALLOWED_URLS,
} from "../scripts/parse_attestation.js";
import { computeAllowedUrlHashes } from "../scripts/compute_url_hashes.js";

const NODE_URL = "http://localhost:8080";
const TEST_TIMEOUT = 600_000;
const ATTESTATION_PATH = "testdata/attestation.json";

const INITIAL_LIQUIDITY = 10000n;
const PRICE_PRECISION = 1_000_000n;
// Threshold: $50,000.00 = 5000000 cents
const PRICE_THRESHOLD = 5000000n;
const THRESHOLD_ABOVE = true; // YES wins if price >= threshold

function hasAttestation(): boolean {
  return fs.existsSync(ATTESTATION_PATH);
}

describe("PredictionMarketZkTLS", () => {
  let wallet: EmbeddedWallet;
  let adminAddress: AztecAddress;
  let aliceAddress: AztecAddress;
  let bobAddress: AztecAddress;
  let market: PredictionMarketZkTLSContract;
  let paymentMethod: SponsoredFeePaymentMethod;
  let urlHashes: string[];

  // Expiry set in beforeAll after accounts are created (needs enough time for betting)
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

    // Compute URL hashes
    urlHashes = await computeAllowedUrlHashes(DEFAULT_ALLOWED_URLS);

    // Set expiry AFTER account creation so we have enough time for betting
    // 5 minutes from now — enough for several tx before expiry
    expiry = BigInt(Math.floor(Date.now() / 1000) + 300);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (wallet) await wallet.stop();
  });

  // ===== DEPLOYMENT =====

  test(
    "should deploy prediction market with config",
    async () => {
      const sendOpts = { from: adminAddress, fee: { paymentMethod } };

      ({ contract: market } = await PredictionMarketZkTLSContract.deploy(
        wallet,
        adminAddress,
        INITIAL_LIQUIDITY,
        expiry,
        PRICE_THRESHOLD,
        THRESHOLD_ABOVE,
        urlHashes as unknown as FieldLike[],
      ).send(sendOpts));

      expect(market.address).toBeDefined();
      console.log(`Market deployed: ${market.address}`);
    },
    TEST_TIMEOUT,
  );

  test(
    "should have initial 50/50 prices",
    async () => {
      const { result: yesPrice } = await market.methods
        .get_price(true)
        .simulate({ from: adminAddress });
      const { result: noPrice } = await market.methods
        .get_price(false)
        .simulate({ from: adminAddress });

      expect(yesPrice).toBe(PRICE_PRECISION / 2n);
      expect(noPrice).toBe(PRICE_PRECISION / 2n);

      console.log(
        `YES: ${(Number(yesPrice) / 1e6) * 100}%, NO: ${(Number(noPrice) / 1e6) * 100}%`,
      );
    },
    TEST_TIMEOUT,
  );

  test(
    "should report market is not resolved",
    async () => {
      const { result: resolved } = await market.methods
        .is_resolved()
        .simulate({ from: adminAddress });
      expect(resolved).toBe(false);
    },
    TEST_TIMEOUT,
  );

  // ===== PRIVATE BETTING =====

  test(
    "alice deposits collateral privately",
    async () => {
      const sendOpts = { from: aliceAddress, fee: { paymentMethod } };

      const { receipt } = await market.methods
        .deposit(5000n)
        .send(sendOpts);
      expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);

      const { result: balance } = await market.methods
        .get_collateral_balance(aliceAddress)
        .simulate({ from: aliceAddress });
      expect(balance).toBe(5000n);
      console.log(`Alice collateral: ${balance}`);
    },
    TEST_TIMEOUT,
  );

  test(
    "alice buys YES shares privately",
    async () => {
      const sendOpts = { from: aliceAddress, fee: { paymentMethod } };

      const { receipt } = await market.methods
        .buy_outcome(true, 2000n, 0n)
        .send(sendOpts);
      expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);

      const { result: collateral } = await market.methods
        .get_collateral_balance(aliceAddress)
        .simulate({ from: aliceAddress });
      expect(collateral).toBe(3000n); // 5000 - 2000

      const { result: yesBalance } = await market.methods
        .get_yes_balance(aliceAddress)
        .simulate({ from: aliceAddress });
      expect(yesBalance).toBeGreaterThan(0n);

      console.log(`Alice: collateral=${collateral}, YES=${yesBalance}`);
    },
    TEST_TIMEOUT,
  );

  test(
    "bob deposits and buys NO shares privately",
    async () => {
      const sendOpts = { from: bobAddress, fee: { paymentMethod } };

      await market.methods.deposit(5000n).send(sendOpts);
      const { receipt } = await market.methods
        .buy_outcome(false, 2000n, 0n)
        .send(sendOpts);
      expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);

      const { result: noBalance } = await market.methods
        .get_no_balance(bobAddress)
        .simulate({ from: bobAddress });
      expect(noBalance).toBeGreaterThan(0n);

      console.log(`Bob NO balance: ${noBalance}`);
    },
    TEST_TIMEOUT,
  );

  test(
    "YES price increases after alice's purchase",
    async () => {
      const { result: yesPrice } = await market.methods
        .get_price(true)
        .simulate({ from: adminAddress });
      const { result: noPrice } = await market.methods
        .get_price(false)
        .simulate({ from: adminAddress });

      expect(yesPrice).toBeGreaterThan(PRICE_PRECISION / 2n);
      expect(noPrice).toBeLessThan(PRICE_PRECISION / 2n);

      // Prices should sum to ~1.0 (allow rounding)
      const sum = yesPrice + noPrice;
      expect(sum).toBeGreaterThanOrEqual(PRICE_PRECISION - 1n);
      expect(sum).toBeLessThanOrEqual(PRICE_PRECISION);

      console.log(
        `After trades: YES=${(Number(yesPrice) / 1e6) * 100}%, NO=${(Number(noPrice) / 1e6) * 100}%`,
      );
    },
    TEST_TIMEOUT,
  );

  test(
    "alice and bob have separate private balances",
    async () => {
      const { result: aliceYes } = await market.methods
        .get_yes_balance(aliceAddress)
        .simulate({ from: aliceAddress });
      const { result: aliceNo } = await market.methods
        .get_no_balance(aliceAddress)
        .simulate({ from: aliceAddress });
      const { result: bobYes } = await market.methods
        .get_yes_balance(bobAddress)
        .simulate({ from: bobAddress });
      const { result: bobNo } = await market.methods
        .get_no_balance(bobAddress)
        .simulate({ from: bobAddress });

      expect(aliceYes).toBeGreaterThan(0n);
      expect(aliceNo).toBe(0n);
      expect(bobYes).toBe(0n);
      expect(bobNo).toBeGreaterThan(0n);

      console.log(`Alice: YES=${aliceYes}, NO=${aliceNo}`);
      console.log(`Bob:   YES=${bobYes}, NO=${bobNo}`);
    },
    TEST_TIMEOUT,
  );

  // ===== COLLATERAL MANAGEMENT =====

  test(
    "alice can withdraw remaining collateral",
    async () => {
      const sendOpts = { from: aliceAddress, fee: { paymentMethod } };

      const { receipt } = await market.methods
        .withdraw(1000n)
        .send(sendOpts);
      expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);

      const { result: balance } = await market.methods
        .get_collateral_balance(aliceAddress)
        .simulate({ from: aliceAddress });
      expect(balance).toBe(2000n); // 3000 - 1000

      console.log(`Alice collateral after withdraw: ${balance}`);
    },
    TEST_TIMEOUT,
  );

  // ===== REDEMPTION BEFORE RESOLUTION (should fail) =====

  test(
    "should reject redemption before resolution",
    async () => {
      const sendOpts = { from: aliceAddress, fee: { paymentMethod } };

      // redeem reads PublicImmutable<Resolution> which is uninitialized
      await expect(
        market.methods.redeem(100n).send(sendOpts),
      ).rejects.toThrow();

      console.log("Pre-resolution redemption correctly rejected");
    },
    TEST_TIMEOUT,
  );

  // ===== zkTLS RESOLUTION =====
  // These tests require testdata/attestation.json from generate_attestation.ts

  test(
    "should resolve market with valid zkTLS attestation",
    async () => {
      if (!hasAttestation()) {
        console.log("Skipping: no attestation file. Run generate_attestation.ts first.");
        return;
      }

      // Wait for market to expire (if not already past)
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

      // PublicImmutable::initialize fails on second call
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

  test(
    "should block betting after resolution",
    async () => {
      if (!hasAttestation()) {
        console.log("Skipping: no attestation file.");
        return;
      }

      const sendOpts = { from: aliceAddress, fee: { paymentMethod } };

      // buy_outcome's _process_buy checks resolution.is_initialized()
      await expect(
        market.methods.buy_outcome(true, 100n, 0n).send(sendOpts),
      ).rejects.toThrow();

      console.log("Post-resolution betting correctly blocked");
    },
    TEST_TIMEOUT,
  );

  // ===== PRIVATE SETTLEMENT =====

  test(
    "winner redeems shares for collateral",
    async () => {
      if (!hasAttestation()) {
        console.log("Skipping: no attestation file.");
        return;
      }

      const { result: outcomeIsYes } = await market.methods
        .get_resolution_outcome()
        .simulate({ from: adminAddress });

      if (outcomeIsYes) {
        // Alice holds YES shares — she wins
        const { result: yesBalance } = await market.methods
          .get_yes_balance(aliceAddress)
          .simulate({ from: aliceAddress });
        expect(yesBalance).toBeGreaterThan(0n);

        const { result: collateralBefore } = await market.methods
          .get_collateral_balance(aliceAddress)
          .simulate({ from: aliceAddress });

        const sendOpts = { from: aliceAddress, fee: { paymentMethod } };
        const { receipt } = await market.methods
          .redeem(yesBalance)
          .send(sendOpts);
        expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);

        const { result: collateralAfter } = await market.methods
          .get_collateral_balance(aliceAddress)
          .simulate({ from: aliceAddress });
        expect(collateralAfter).toBe(collateralBefore + yesBalance);

        console.log(
          `Alice redeemed ${yesBalance} YES shares. Collateral: ${collateralBefore} -> ${collateralAfter}`,
        );
      } else {
        // Bob holds NO shares — he wins
        const { result: noBalance } = await market.methods
          .get_no_balance(bobAddress)
          .simulate({ from: bobAddress });
        expect(noBalance).toBeGreaterThan(0n);

        const { result: collateralBefore } = await market.methods
          .get_collateral_balance(bobAddress)
          .simulate({ from: bobAddress });

        const sendOpts = { from: bobAddress, fee: { paymentMethod } };
        const { receipt } = await market.methods
          .redeem(noBalance)
          .send(sendOpts);
        expect(receipt.executionResult).toBe(TxExecutionResult.SUCCESS);

        const { result: collateralAfter } = await market.methods
          .get_collateral_balance(bobAddress)
          .simulate({ from: bobAddress });
        expect(collateralAfter).toBe(collateralBefore + noBalance);

        console.log(
          `Bob redeemed ${noBalance} NO shares. Collateral: ${collateralBefore} -> ${collateralAfter}`,
        );
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "loser cannot redeem (no winning shares)",
    async () => {
      if (!hasAttestation()) {
        console.log("Skipping: no attestation file.");
        return;
      }

      const { result: outcomeIsYes } = await market.methods
        .get_resolution_outcome()
        .simulate({ from: adminAddress });

      if (outcomeIsYes) {
        // Bob holds NO shares — trying to redeem should fail (he has no YES shares)
        const sendOpts = { from: bobAddress, fee: { paymentMethod } };
        await expect(
          market.methods.redeem(100n).send(sendOpts),
        ).rejects.toThrow();

        console.log("Bob (NO holder) correctly cannot redeem after YES resolution");
      } else {
        // Alice holds YES shares — trying to redeem should fail (she has no NO shares)
        const sendOpts = { from: aliceAddress, fee: { paymentMethod } };
        await expect(
          market.methods.redeem(100n).send(sendOpts),
        ).rejects.toThrow();

        console.log("Alice (YES holder) correctly cannot redeem after NO resolution");
      }
    },
    TEST_TIMEOUT,
  );
});
