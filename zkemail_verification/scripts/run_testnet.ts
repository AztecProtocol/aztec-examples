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

  console.log("Deploying ZKEmailVerifier contract...");
  const { contract: zkEmailVerifier } = await ZKEmailVerifierContract.deploy(
    testWallet,
    ownerAddress,
    data.vkHash as unknown as FieldLike
  ).send(sendOpts);

  console.log(`Contract deployed at: ${zkEmailVerifier.address.toString()}`);

  // Check initial verification count
  let counterValue = (await zkEmailVerifier.methods
    .get_verification_count(ownerAddress)
    .simulate({ from: ownerAddress })).result;
  console.log(`Initial verification count: ${counterValue}`);

  console.log("Submitting ZK email proof for on-chain verification...");
  const { receipt: tx } = await zkEmailVerifier.methods.verify_email(
    ownerAddress,
    data.vkAsFields as unknown as FieldLike[],
    data.proofAsFields as unknown as FieldLike[],
    data.publicInputs as unknown as FieldLike[],
  ).send(sendOpts);

  console.log(`Transaction hash: ${tx.txHash.toString()}`);
  console.log(`Transaction status: ${tx.status}`);

  // Read verification count
  counterValue = (await zkEmailVerifier.methods
    .get_verification_count(ownerAddress)
    .simulate({ from: ownerAddress })).result;
  console.log(`Verification count after proof: ${counterValue}`);

  assert(counterValue === 1n, `Expected verification count 1, got ${counterValue}`);
  console.log("SUCCESS: ZK email proof verified on Aztec testnet!");

  await testWallet.stop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
