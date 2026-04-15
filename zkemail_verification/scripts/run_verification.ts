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

  console.log("Deploying ZKEmailVerifier contract...");
  const { contract: zkEmailVerifier } = await ZKEmailVerifierContract.deploy(
    testWallet,
    ownerAddress,
    data.vkHash as unknown as FieldLike
  )
    .send({
      from: ownerAddress,
      fee: { paymentMethod: sponsoredPaymentMethod },
    });

  console.log("Contract deployed at:", zkEmailVerifier.address.toString());

  // Check initial verification count
  let counterValue = (await zkEmailVerifier.methods
    .get_verification_count(ownerAddress)
    .simulate({ from: ownerAddress })).result;
  console.log(`Initial verification count: ${counterValue}`);

  console.log("Submitting email proof for on-chain verification (this may take 5-15 minutes with real proofs)...");
  const opts = {
    from: ownerAddress,
    fee: { paymentMethod: sponsoredPaymentMethod },
  };

  await zkEmailVerifier.methods.verify_email(
    ownerAddress,
    data.vkAsFields as unknown as FieldLike[],
    data.proofAsFields as unknown as FieldLike[],
    data.publicInputs as unknown as FieldLike[],
  ).send(opts);

  // Check verification count after
  counterValue = (await zkEmailVerifier.methods
    .get_verification_count(ownerAddress)
    .simulate({ from: ownerAddress })).result;
  console.log(`Verification count after proof: ${counterValue}`);

  assert(counterValue === 1n, `Expected verification count to be 1, got ${counterValue}`);
  console.log("SUCCESS: Email proof verified on-chain!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
