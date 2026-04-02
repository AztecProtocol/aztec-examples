/**
 * deploy_and_resolve.ts
 *
 * End-to-end lifecycle demo:
 *   1. Connect to local Aztec network and create wallets
 *   2. Compute Poseidon2 URL hashes for CoinGecko
 *   3. Deploy PredictionMarketZkTLS contract
 *   4. Alice deposits collateral and buys YES
 *   5. Bob deposits collateral and buys NO
 *   6. Resolve market with a zkTLS attestation
 *   7. Winner redeems shares for collateral
 *
 * Prerequisites:
 *   - Aztec local network running: `aztec start --local-network`
 *   - Contract compiled: `yarn ccc`
 *   - Attestation file at testdata/attestation.json (see generate_attestation.ts)
 *
 * Usage:
 *   yarn demo [attestation-file]
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import type { FieldLike } from "@aztec/aztec.js/abi";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import assert from "node:assert";

import { PredictionMarketZkTLSContract } from "../artifacts/PredictionMarketZkTLS.js";
import { getSponsoredFPCInstance } from "./sponsored_fpc.js";
import {
  parseAttestationFile,
  DEFAULT_ALLOWED_URLS,
} from "./parse_attestation.js";
import { computeAllowedUrlHashes } from "./compute_url_hashes.js";

const NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const ATTESTATION_PATH = process.argv[2] ?? "testdata/attestation.json";

// Market parameters
const INITIAL_LIQUIDITY = 10000n;
// Price threshold in cents: $100,000.00 = 10000000
const PRICE_THRESHOLD = 10000000n;
const THRESHOLD_ABOVE = true; // YES wins if BTC >= $100k
// Expiry: 1 minute from now (short for demo purposes)
const EXPIRY_OFFSET_MS = 60_000;

async function main() {
  console.log("=== Private Prediction Market with zkTLS Resolution ===\n");

  // 1. Setup wallet
  console.log(`Connecting to Aztec node at ${NODE_URL}...`);
  const aztecNode = await createAztecNodeClient(NODE_URL);
  const sponsoredFPC = await getSponsoredFPCInstance();
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

  const wallet = await EmbeddedWallet.create(aztecNode, { ephemeral: true });
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact);

  // Create admin account
  console.log("Creating admin account...");
  const adminManager = await wallet.createSchnorrAccount(Fr.random(), Fr.random());
  await (await adminManager.getDeployMethod()).send({
    from: NO_FROM,
    fee: { paymentMethod },
  });

  // Create Alice and Bob accounts
  console.log("Creating Alice account...");
  const aliceManager = await wallet.createSchnorrAccount(Fr.random(), Fr.random());
  await (await aliceManager.getDeployMethod()).send({
    from: NO_FROM,
    fee: { paymentMethod },
  });

  console.log("Creating Bob account...");
  const bobManager = await wallet.createSchnorrAccount(Fr.random(), Fr.random());
  await (await bobManager.getDeployMethod()).send({
    from: NO_FROM,
    fee: { paymentMethod },
  });

  const accounts = await wallet.getAccounts();
  const adminAddress = accounts[0].item;
  const aliceAddress = accounts[1].item;
  const bobAddress = accounts[2].item;
  console.log(`Admin: ${adminAddress}`);
  console.log(`Alice: ${aliceAddress}`);
  console.log(`Bob:   ${bobAddress}\n`);

  const sendOpts = (from: typeof adminAddress) => ({
    from,
    fee: { paymentMethod },
  });

  // 2. Compute URL hashes
  console.log("Computing Poseidon2 URL hashes for CoinGecko...");
  const urlHashes = await computeAllowedUrlHashes(DEFAULT_ALLOWED_URLS);

  // 3. Deploy contract
  const expiry = BigInt(Math.floor((Date.now() + EXPIRY_OFFSET_MS) / 1000));
  console.log(`Deploying market (threshold=$${Number(PRICE_THRESHOLD) / 100}, expiry=${expiry})...`);

  const { contract: market } = await PredictionMarketZkTLSContract.deploy(
    wallet,
    adminAddress,
    INITIAL_LIQUIDITY,
    expiry,
    PRICE_THRESHOLD,
    THRESHOLD_ABOVE,
    urlHashes as unknown as FieldLike[],
  ).send(sendOpts(adminAddress));

  console.log(`Market deployed: ${market.address}\n`);

  // 4. Alice deposits and buys YES
  console.log("Alice deposits 5000 collateral...");
  await market.methods.deposit(5000n).send(sendOpts(aliceAddress));

  console.log("Alice buys YES with 3000 collateral...");
  await market.methods.buy_outcome(true, 3000n, 0n).send(sendOpts(aliceAddress));

  const aliceYes = await market.methods.get_yes_balance(aliceAddress).simulate({ from: aliceAddress });
  console.log(`Alice YES balance: ${aliceYes}\n`);

  // 5. Bob deposits and buys NO
  console.log("Bob deposits 5000 collateral...");
  await market.methods.deposit(5000n).send(sendOpts(bobAddress));

  console.log("Bob buys NO with 3000 collateral...");
  await market.methods.buy_outcome(false, 3000n, 0n).send(sendOpts(bobAddress));

  const bobNo = await market.methods.get_no_balance(bobAddress).simulate({ from: bobAddress });
  console.log(`Bob NO balance: ${bobNo}\n`);

  // Show market state
  const yesPrice = await market.methods.get_price(true).simulate({ from: adminAddress });
  const noPrice = await market.methods.get_price(false).simulate({ from: adminAddress });
  console.log(`Market prices: YES=${Number(yesPrice) / 1_000_000 * 100}%, NO=${Number(noPrice) / 1_000_000 * 100}%\n`);

  // 6. Wait for expiry and resolve
  const now = Math.floor(Date.now() / 1000);
  const waitSec = Number(expiry) - now;
  if (waitSec > 0) {
    console.log(`Waiting ${waitSec}s for market expiry...`);
    await new Promise((r) => setTimeout(r, (waitSec + 5) * 1000));
  }

  console.log("Resolving market with zkTLS attestation...");
  const parsed = parseAttestationFile(ATTESTATION_PATH, DEFAULT_ALLOWED_URLS);

  await market.methods
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
    .send(sendOpts(adminAddress));

  const outcomeIsYes = await market.methods.get_resolution_outcome().simulate({ from: adminAddress });
  const resolvedPrice = await market.methods.get_resolution_price().simulate({ from: adminAddress });
  console.log(`Market resolved! Outcome: ${outcomeIsYes ? "YES" : "NO"}, Price: $${Number(resolvedPrice) / 100}\n`);

  // 7. Winner redeems
  if (outcomeIsYes) {
    console.log("Alice (YES holder) redeems shares...");
    const yesBalance = await market.methods.get_yes_balance(aliceAddress).simulate({ from: aliceAddress });
    await market.methods.redeem(yesBalance).send(sendOpts(aliceAddress));
    const collateral = await market.methods.get_collateral_balance(aliceAddress).simulate({ from: aliceAddress });
    console.log(`Alice collateral after redemption: ${collateral}`);
  } else {
    console.log("Bob (NO holder) redeems shares...");
    const noBalance = await market.methods.get_no_balance(bobAddress).simulate({ from: bobAddress });
    await market.methods.redeem(noBalance).send(sendOpts(bobAddress));
    const collateral = await market.methods.get_collateral_balance(bobAddress).simulate({ from: bobAddress });
    console.log(`Bob collateral after redemption: ${collateral}`);
  }

  console.log("\n=== Prediction market lifecycle complete! ===");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
