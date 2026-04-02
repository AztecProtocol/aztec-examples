/**
 * deploy_and_claim.ts
 *
 * End-to-end workflow:
 *   1. Connect to local Aztec network and create a wallet
 *   2. Compute Poseidon2 URL hashes for primus-labs repos
 *   3. Deploy PrimusAirdrop contract (immutable config + deployer)
 *   4. Deploy Token contract with minter = airdrop address
 *   5. Call airdrop.set_token(token.address) — one-time initialization
 *   6. Parse a zkTLS attestation
 *   7. Submit a fully-private claim (attestation verification + nullifier + token mint)
 *   8. Verify the private token balance
 *
 * Prerequisites:
 *   - Aztec local network running: `aztec start --local-network`
 *   - Contracts compiled: `yarn ccc`
 *   - Attestation file at testdata/attestation.json (see generate_attestation.ts)
 *
 * Usage:
 *   yarn claim [attestation-file]
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import type { FieldLike } from "@aztec/aztec.js/abi";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import assert from "node:assert";

import { PrimusAirdropContract } from "../contract/artifacts/PrimusAirdrop.js";
// The Token contract artifact is generated from the token_contract dependency.
// After `yarn ccc`, it's available via the PrimusAirdrop codegen or you can
// compile the token separately. For this example we import from the airdrop's
// codegen which includes cross-contract references.
import { TokenContract } from "../contract/artifacts/Token.js";
type TokenMethods = typeof TokenContract.prototype.methods;
import { getSponsoredFPCInstance } from "./sponsored_fpc.js";
import {
  parseAttestationFile,
  DEFAULT_ALLOWED_URLS,
  MAX_URL_LEN,
  MAX_PLAINTEXT_LEN,
} from "./parse_attestation.js";
import { computeAllowedUrlHashes } from "./compute_url_hashes.js";

const NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const ATTESTATION_PATH = process.argv[2] ?? "testdata/attestation.json";
const AIRDROP_AMOUNT = 1000n;

// No padding needed — the Aztec SDK encodes BoundedVec from raw arrays automatically.

async function main() {
  console.log("=== Primus zkTLS Airdrop (Token Standard) ===\n");

  // 1. Setup wallet
  console.log(`Connecting to Aztec node at ${NODE_URL}...`);
  const aztecNode = await createAztecNodeClient(NODE_URL);
  const sponsoredFPC = await getSponsoredFPCInstance();
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

  const wallet = await EmbeddedWallet.create(aztecNode, { ephemeral: true });
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact);

  // Create account
  console.log("Creating account...");
  const accountManager = await wallet.createSchnorrAccount(
    Fr.random(),
    Fr.random(),
  );
  await (await accountManager.getDeployMethod()).send({
    from: NO_FROM,
    fee: { paymentMethod },
  });

  const accounts = await wallet.getAccounts();
  const account = accounts[0].item;
  console.log(`Account: ${account.toString()}\n`);

  const sendOpts = { from: account, fee: { paymentMethod } };

  // 2. Compute Poseidon2 URL hashes
  console.log("Computing Poseidon2 URL hashes...");
  const urlHashes = await computeAllowedUrlHashes(DEFAULT_ALLOWED_URLS);

  // 3. Deploy PrimusAirdrop contract
  console.log("Deploying PrimusAirdrop...");
  const { contract: airdrop } = await PrimusAirdropContract.deploy(
    wallet,
    account, // deployer
    urlHashes as unknown as FieldLike[], // allowed_url_hashes
    AIRDROP_AMOUNT, // airdrop_amount
  ).send(sendOpts);

  console.log(`  Airdrop: ${airdrop.address.toString()}`);

  // 4. Deploy Token contract with minter = airdrop address
  console.log("Deploying Token (minter = airdrop)...");
  const { contract: token } = await TokenContract.deployWithOpts<"constructor_with_minter">(
    { method: "constructor_with_minter", wallet },
    "Primus Airdrop Token", // name
    "PRIMUS", // symbol
    18, // decimals
    airdrop.address, // minter = the airdrop contract
  ).send(sendOpts);

  console.log(`  Token:   ${token.address.toString()}`);

  // 5. Link: airdrop.set_token(token.address) — one-time initialization
  console.log("Linking airdrop → token...");
  await airdrop.methods.set_token(token.address).send(sendOpts);
  console.log("  Linked.\n");

  // 6. Parse attestation
  console.log(`Parsing attestation from ${ATTESTATION_PATH}...`);
  const parsed = parseAttestationFile(ATTESTATION_PATH, DEFAULT_ALLOWED_URLS);

  const username = Buffer.from(
    parsed.githubUsername.filter((b) => b !== 0),
  ).toString();
  const githubId = Buffer.from(
    parsed.githubId.filter((b) => b !== 0),
  ).toString();
  console.log(`  GitHub user: ${username}`);
  console.log(`  GitHub ID:   ${githubId}\n`);

  // 7. Submit fully-private claim
  console.log("Submitting claim (attestation + nullifier + private mint)...");
  const { receipt } = await airdrop.methods
    .claim(
      parsed.publicKeyX as unknown as FieldLike[],
      parsed.publicKeyY as unknown as FieldLike[],
      parsed.hash as unknown as FieldLike[],
      parsed.signature as unknown as FieldLike[],
      parsed.requestUrls as unknown as FieldLike[][],
      parsed.allowedUrls as unknown as FieldLike[][],
      parsed.dataHashes as unknown as FieldLike[][],
      parsed.contents as unknown as FieldLike[][],
      parsed.githubUsername as unknown as FieldLike[],
      parsed.githubId as unknown as FieldLike[],
    )
    .send(sendOpts);

  console.log(`  Tx hash: ${receipt.txHash.toString()}`);
  console.log(`  Status:  ${receipt.status}\n`);

  // 8. Verify private token balance
  console.log("Querying private token balance...");
  const balance = await token.methods
    .balance_of_private(account)
    .simulate({ from: account });

  console.log(`  Private balance: ${balance}`);
  assert(
    BigInt(balance.toString()) === AIRDROP_AMOUNT,
    `Expected ${AIRDROP_AMOUNT}, got ${balance}`,
  );

  console.log("\n=== Airdrop claimed successfully! ===");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
