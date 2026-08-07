import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import type { FieldLike } from "@aztec/aztec.js/abi";
import { getSponsoredFPCInstance } from "./sponsored_fpc.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { EmailClaimContract } from "../contract/artifacts/EmailClaim";
import data from "../data.json";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { SetPublicAuthwitContractInteraction } from "@aztec/aztec.js/authorization";
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon";
import { DomainSeparator } from "@aztec/constants";

const TESTNET_URL = "https://rpc.testnet.aztec-labs.com";

// Maximum email age in seconds. Set very large for testing with old test email (April 2024).
// In production, use a much shorter window (e.g., 15 * 60 for 15 minutes).
const MAX_EMAIL_AGE = 100 * 365 * 24 * 60 * 60;
const DEPOSIT_AMOUNT = 500n;
const CLAIM_AMOUNT = 100n;

const sponsoredFPC = await getSponsoredFPCInstance();
const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(
  sponsoredFPC.address
);

async function main() {
  console.log(`Connecting to Aztec testnet at ${TESTNET_URL}...`);
  const aztecNode = await createAztecNodeClient(TESTNET_URL);

  const nodeInfo = await aztecNode.getNodeInfo();
  console.log(`Testnet node version: ${nodeInfo.nodeVersion}`);

  console.log("Creating EmbeddedWallet...");
  const testWallet = await EmbeddedWallet.create(aztecNode, {
    pxeConfig: { proverEnabled: true },
    ephemeral: true,
  });
  await testWallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact);

  // Create two accounts: Bob (depositor) and Carol (recipient)
  console.log("Creating Bob's account...");
  const bobAccount = await testWallet.createSchnorrAccount(Fr.random(), Fr.random());
  await (await bobAccount.getDeployMethod()).send({
    from: NO_FROM,
    fee: { paymentMethod: sponsoredPaymentMethod },
  });

  console.log("Creating Carol's account...");
  const carolAccount = await testWallet.createSchnorrAccount(Fr.random(), Fr.random());
  await (await carolAccount.getDeployMethod()).send({
    from: NO_FROM,
    fee: { paymentMethod: sponsoredPaymentMethod },
  });

  const accounts = await testWallet.getAccounts();
  const bobAddress = accounts[0].item;
  const carolAddress = accounts[1].item;
  console.log(`Bob:   ${bobAddress}`);
  console.log(`Carol: ${carolAddress}`);

  const sendOpts = (from: any) => ({
    from,
    fee: { paymentMethod: sponsoredPaymentMethod },
  });

  // Public inputs from proof
  const trustedDkimKeyHash0 = data.publicInputs[0] as unknown as FieldLike;
  const trustedDkimKeyHash1 = data.publicInputs[1] as unknown as FieldLike;
  const fromAddressHash = data.publicInputs[3] as unknown as FieldLike;
  const toAddressHash = data.publicInputs[4] as unknown as FieldLike;
  const intentHash = data.publicInputs[5] as unknown as FieldLike;

  // 1. Deploy Token contract
  console.log("\n--- Deploy Token ---");
  const { contract: token } = await TokenContract.deploy(
    testWallet,
    bobAddress,
    "TestToken",
    "TT",
    18,
  ).send(sendOpts(bobAddress));
  console.log(`Token deployed at: ${token.address}`);

  // Mint tokens to Bob
  await token.methods.mint_to_public(bobAddress, DEPOSIT_AMOUNT).send(sendOpts(bobAddress));
  console.log(`Minted ${DEPOSIT_AMOUNT} tokens to Bob`);

  // 2. Deploy EmailClaim contract
  console.log("\n--- Deploy EmailClaim ---");
  const { contract: emailClaim } = await EmailClaimContract.deploy(
    testWallet,
    token.address,
    data.vkHash as unknown as FieldLike,
    trustedDkimKeyHash0,
    trustedDkimKeyHash1,
    MAX_EMAIL_AGE,
  ).send(sendOpts(bobAddress));
  console.log(`EmailClaim deployed at: ${emailClaim.address}`);

  // 3. Bob deposits tokens
  console.log("\n--- Bob Deposits ---");
  const authwitNonce = Fr.random();
  const depositAction = token.methods.transfer_in_public(bobAddress, emailClaim.address, DEPOSIT_AMOUNT, authwitNonce);
  const authwit = await SetPublicAuthwitContractInteraction.create(
    testWallet,
    bobAddress,
    { caller: emailClaim.address, action: depositAction },
    true,
  );
  await authwit.send(sendOpts(bobAddress));

  await emailClaim.methods.deposit(
    fromAddressHash,
    DEPOSIT_AMOUNT,
    authwitNonce,
  ).send(sendOpts(bobAddress));
  console.log(`Bob deposited ${DEPOSIT_AMOUNT} tokens`);

  // 4. Carol creates a claim
  console.log("\n--- Carol Creates Claim ---");
  // Carol generates randomness and computes the commitment offchain
  const randomness = Fr.random();
  const commitment = await poseidon2HashWithSeparator(
    [carolAddress.toField(), randomness],
    DomainSeparator.NOTE_HASH,
  );

  // Carol submits the partial note creation
  await emailClaim.methods.create_claim(randomness).send(sendOpts(carolAddress));
  console.log(`Partial note commitment: ${commitment}`);

  // 5. Carol claims with email proof
  console.log("\n--- Carol Claims with Email Proof ---");
  const { receipt: tx } = await emailClaim.methods.claim_with_email(
    toAddressHash,
    intentHash,
    { commitment },
    CLAIM_AMOUNT,
    data.vkAsFields as unknown as FieldLike[],
    data.proofAsFields as unknown as FieldLike[],
    data.publicInputs as unknown as FieldLike[],
  ).send(sendOpts(carolAddress));
  console.log(`Claim tx: ${tx.txHash}`);
  console.log(`Status: ${tx.status}`);

  // 6. Verify
  console.log("\n--- Verify ---");
  const depositAfter = (await emailClaim.methods.get_deposit_balance(fromAddressHash).simulate({ from: bobAddress })).result;
  console.log(`Bob's deposit balance: ${depositAfter}`);
  console.log("\nSUCCESS: Offchain email-authorized token transfer completed on testnet!");

  await testWallet.stop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
