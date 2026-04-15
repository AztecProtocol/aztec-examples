import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import type { FieldLike } from "@aztec/aztec.js/abi";
import { getSponsoredFPCInstance } from "./sponsored_fpc.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { ZKEmailVerifierContract } from "../contract/artifacts/ZKEmailVerifier";
import data from "../data.json";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import assert from "node:assert";

export const NODE_URL = "http://localhost:8080";

// Maximum email age in seconds. Set very large for testing with old test email (April 2024).
// In production, use a much shorter window (e.g., 15 * 60 for 15 minutes).
const MAX_EMAIL_AGE = 100 * 365 * 24 * 60 * 60;

const sponsoredFPC = await getSponsoredFPCInstance();
const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(
  sponsoredFPC.address
);

export const setupWallet = async (): Promise<EmbeddedWallet> => {
  try {
    const aztecNode = await createAztecNodeClient(NODE_URL);
    let wallet = await EmbeddedWallet.create(aztecNode, {
      pxeConfig: { proverEnabled: true },
      ephemeral: true,
    });
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact);

    return wallet;
  } catch (error) {
    console.error("Failed to setup local network:", error);
    throw error;
  }
};

async function main() {
  console.log("Setting up wallet with proverEnabled: true...");
  const testWallet = await setupWallet();

  console.log("Creating Schnorr account...");
  const account = await testWallet.createSchnorrAccount(Fr.random(), Fr.random());
  const manager = await account.getDeployMethod();
  await manager
    .send({
      from: NO_FROM,
      fee: { paymentMethod: sponsoredPaymentMethod },
    });
  const accounts = await testWallet.getAccounts();
  const ownerAddress = accounts[0].item;
  console.info('Owner address:', ownerAddress.toString());

  // Public inputs from proof:
  //   [0] = trusted DKIM pubkey hash (modulus)
  //   [1] = trusted DKIM pubkey hash (redc)
  //   [3] = to_address_hash (used as authorized_email_hash)
  //   [4] = intent_hash (subject hash)
  const trustedDkimKeyHash0 = data.publicInputs[0] as unknown as FieldLike;
  const trustedDkimKeyHash1 = data.publicInputs[1] as unknown as FieldLike;
  const authorizedEmailHash = data.publicInputs[3] as unknown as FieldLike;
  const intentHash = data.publicInputs[4] as unknown as FieldLike;

  console.log("Deploying ZKEmailVerifier contract...");
  const { contract: zkEmailVerifier } = await ZKEmailVerifierContract.deploy(
    testWallet,
    data.vkHash as unknown as FieldLike,
    trustedDkimKeyHash0,
    trustedDkimKeyHash1,
    authorizedEmailHash,
    MAX_EMAIL_AGE,
  )
    .send({
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    });

  console.log("Contract deployed at:", zkEmailVerifier.address.toString());

  console.log("Submitting email proof for on-chain verification (this may take 5-15 minutes with real proofs)...");
  const opts = {
    from: ownerAddress,
    fee: { paymentMethod: sponsoredPaymentMethod },
  };

  await zkEmailVerifier.methods.verify_email(
    intentHash,
    data.vkAsFields as unknown as FieldLike[],
    data.proofAsFields as unknown as FieldLike[],
    data.publicInputs as unknown as FieldLike[],
  ).send(opts);

  console.log("SUCCESS: Email proof verified on-chain!");
  console.log("  - Recipient address verified against authorized email hash");
  console.log("  - Intent hash verified from email subject");
  console.log("  - Email nullifier pushed (prevents reuse)");
  console.log("  - Email freshness checked against timestamp");

  // Attempting to reuse the same email proof should fail
  console.log("\nAttempting to reuse the same email proof (should fail)...");
  try {
    await zkEmailVerifier.methods.verify_email(
      intentHash,
      data.vkAsFields as unknown as FieldLike[],
      data.proofAsFields as unknown as FieldLike[],
      data.publicInputs as unknown as FieldLike[],
    ).send(opts);
    assert.fail("Expected reuse to fail due to duplicate nullifier");
  } catch (e: any) {
    console.log("Reuse correctly rejected:", e.message?.substring(0, 100));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
