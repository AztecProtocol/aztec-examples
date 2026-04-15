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

const TESTNET_URL = "https://rpc.testnet.aztec-labs.com";

// Maximum email age in seconds. Set very large for testing with old test email (April 2024).
// In production, use a much shorter window (e.g., 15 * 60 for 15 minutes).
const MAX_EMAIL_AGE = 100 * 365 * 24 * 60 * 60;

const sponsoredFPC = await getSponsoredFPCInstance();
const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(
  sponsoredFPC.address
);

async function main() {
  console.log(`Connecting to Aztec testnet at ${TESTNET_URL}...`);
  const aztecNode = await createAztecNodeClient(TESTNET_URL);

  const nodeInfo = await aztecNode.getNodeInfo();
  console.log(`Testnet node version: ${nodeInfo.nodeVersion}`);
  console.log(`Real proofs enabled: ${nodeInfo.realProofs}`);

  console.log("Creating EmbeddedWallet...");
  const testWallet = await EmbeddedWallet.create(aztecNode, {
    pxeConfig: { proverEnabled: true },
    ephemeral: true,
  });
  await testWallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact);
  console.log("EmbeddedWallet configured");

  console.log("Creating Schnorr account...");
  const account = await testWallet.createSchnorrAccount(Fr.random(), Fr.random());
  const manager = await account.getDeployMethod();
  console.log("Deploying account (this will take a while on testnet with real proofs)...");
  await manager.send({
    from: NO_FROM,
    fee: { paymentMethod: sponsoredPaymentMethod },
  });

  const accounts = await testWallet.getAccounts();
  const ownerAddress = accounts[0].item;
  console.log(`Owner address: ${ownerAddress.toString()}`);

  const sendOpts = {
    from: ownerAddress,
    fee: { paymentMethod: sponsoredPaymentMethod },
  };

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
  ).send(sendOpts);

  console.log(`Contract deployed at: ${zkEmailVerifier.address.toString()}`);

  console.log("Submitting ZK email proof for on-chain verification...");
  const { receipt: tx } = await zkEmailVerifier.methods.verify_email(
    intentHash,
    data.vkAsFields as unknown as FieldLike[],
    data.proofAsFields as unknown as FieldLike[],
    data.publicInputs as unknown as FieldLike[],
  ).send(sendOpts);

  console.log(`Transaction hash: ${tx.txHash.toString()}`);
  console.log(`Transaction status: ${tx.status}`);

  console.log("SUCCESS: ZK email proof verified on Aztec testnet!");
  console.log("  - Recipient address verified against authorized email hash");
  console.log("  - Intent hash verified from email subject");
  console.log("  - Email nullifier pushed (prevents reuse)");
  console.log("  - Email freshness checked against timestamp");

  await testWallet.stop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
