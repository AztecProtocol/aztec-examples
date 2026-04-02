/**
 * deploy_and_resolve.ts
 *
 * End-to-end lifecycle demo (complete-set model):
 *   1. Connect to local Aztec network and create wallets
 *   2. Deploy PredictionMarketZkTLS + Token contracts
 *   3. Distribute tokens and mint complete sets
 *   4. Resolve market with a zkTLS attestation
 *   5. Winner redeems shares for collateral tokens
 *
 * Prerequisites:
 *   - Aztec local network running: `aztec start --local-network`
 *   - Contract compiled: `yarn ccc`
 *   - Attestation file at testdata/attestation.json
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import type { FieldLike } from "@aztec/aztec.js/abi";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";

import { PredictionMarketZkTLSContract } from "../artifacts/PredictionMarketZkTLS.js";
import { TokenContract } from "../artifacts/Token.js";
import { getSponsoredFPCInstance } from "./sponsored_fpc.js";
import {
  parseAttestationFile,
  DEFAULT_ALLOWED_URLS,
} from "./parse_attestation.js";
import { computeAllowedUrlHashes, computeAttesterKeyHash } from "./compute_url_hashes.js";
import { Barretenberg } from "@aztec/bb.js";

const NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const ATTESTATION_PATH = process.argv[2] ?? "testdata/attestation.json";

// Market parameters
const PRICE_THRESHOLD = 5000000n; // $50,000.00 in cents
const THRESHOLD_ABOVE = true; // YES wins if BTC >= threshold
const EXPIRY_OFFSET_MS = 60_000; // 1 minute for demo
const TOKEN_MINT = 10000n;
const SET_AMOUNT = 5000n;

async function main() {
  console.log("=== Private Prediction Market with zkTLS Resolution ===\n");
  console.log("Model: Complete sets (provably solvent)\n");

  // 1. Setup
  console.log(`Connecting to Aztec node at ${NODE_URL}...`);
  const aztecNode = await createAztecNodeClient(NODE_URL);
  const sponsoredFPC = await getSponsoredFPCInstance();
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

  const wallet = await EmbeddedWallet.create(aztecNode, { ephemeral: true });
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact);

  // Create accounts
  console.log("Creating accounts...");
  for (const name of ["Admin", "Alice", "Bob"]) {
    const mgr = await wallet.createSchnorrAccount(Fr.random(), Fr.random());
    await (await mgr.getDeployMethod()).send({ from: NO_FROM, fee: { paymentMethod } });
    console.log(`  ${name} created`);
  }

  const accounts = await wallet.getAccounts();
  const [adminAddr, aliceAddr, bobAddr] = accounts.map((a) => a.item);
  console.log(`Admin: ${adminAddr}\nAlice: ${aliceAddr}\nBob:   ${bobAddr}\n`);

  const sendAs = (from: typeof adminAddr) => ({ from, fee: { paymentMethod } });

  // 2. Deploy contracts
  console.log("Computing URL hashes...");
  const urlHashes = await computeAllowedUrlHashes(DEFAULT_ALLOWED_URLS);

  // Compute trusted attester key hash from the attestation
  console.log("Computing attester key hash from attestation...");
  const parsed = parseAttestationFile(ATTESTATION_PATH, DEFAULT_ALLOWED_URLS);
  const bb = await Barretenberg.new({ threads: 1 });
  const attesterKeyHash = await computeAttesterKeyHash(bb, parsed.publicKeyX, parsed.publicKeyY);
  await bb.destroy();
  console.log(`  Attester key hash: ${attesterKeyHash}`);

  const expiry = BigInt(Math.floor((Date.now() + EXPIRY_OFFSET_MS) / 1000));
  console.log(`Deploying market (threshold=$${Number(PRICE_THRESHOLD) / 100}, expiry=${expiry})...`);

  const { contract: market } = await PredictionMarketZkTLSContract.deploy(
    wallet, adminAddr, expiry, PRICE_THRESHOLD, THRESHOLD_ABOVE,
    urlHashes as unknown as FieldLike[],
    attesterKeyHash,
  ).send(sendAs(adminAddr));
  console.log(`  Market: ${market.address}`);

  const { contract: token } = await TokenContract.deployWithOpts<"constructor_with_minter">(
    { method: "constructor_with_minter", wallet },
    "Prediction Collateral", "PCOL", 18, adminAddr,
  ).send(sendAs(adminAddr));
  console.log(`  Token:  ${token.address}`);

  await market.methods.set_token(token.address).send(sendAs(adminAddr));
  console.log("  Linked market -> token");

  // Mint tokens to Alice and Bob
  await token.methods.mint_to_private(aliceAddr, TOKEN_MINT).send(sendAs(adminAddr));
  await token.methods.mint_to_private(bobAddr, TOKEN_MINT).send(sendAs(adminAddr));
  console.log(`  Minted ${TOKEN_MINT} tokens each\n`);

  // 3. Mint complete sets
  for (const [name, addr] of [["Alice", aliceAddr], ["Bob", bobAddr]] as const) {
    const nonce = Fr.random();
    const witness = await wallet.createAuthWit(addr, {
      caller: market.address,
      action: token.methods.transfer_private_to_public(addr, market.address, SET_AMOUNT, nonce),
    });
    await market.methods.mint_sets(SET_AMOUNT, nonce).send({ ...sendAs(addr), authWitnesses: [witness] });
    console.log(`${name} minted ${SET_AMOUNT} complete sets (YES + NO)`);
  }

  const totalSets = await market.methods.get_total_sets().simulate({ from: adminAddr });
  console.log(`Total sets outstanding: ${totalSets}\n`);

  // 4. Wait for expiry and resolve
  const now = Math.floor(Date.now() / 1000);
  const waitSec = Number(expiry) - now;
  if (waitSec > 0) {
    console.log(`Waiting ${waitSec}s for market expiry...`);
    await new Promise((r) => setTimeout(r, (waitSec + 5) * 1000));
  }

  console.log("Resolving market with zkTLS attestation...");

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
    .send(sendAs(adminAddr));

  const outcomeIsYes = await market.methods.get_resolution_outcome().simulate({ from: adminAddr });
  const resolvedPrice = await market.methods.get_resolution_price().simulate({ from: adminAddr });
  console.log(`Resolved! Outcome: ${outcomeIsYes ? "YES" : "NO"}, Price: $${Number(resolvedPrice) / 100}\n`);

  // 5. Winner redeems
  console.log("Alice redeems winning shares...");
  await market.methods.redeem(SET_AMOUNT).send(sendAs(aliceAddr));
  const aliceTokens = await token.methods.balance_of_private(aliceAddr).simulate({ from: aliceAddr });
  console.log(`Alice token balance after redemption: ${aliceTokens}`);

  console.log("\n=== Prediction market lifecycle complete! ===");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
