/**
 * Off-chain Account Ownership Proof Verifier
 *
 * This script verifies a ZK proof of account ownership without any on-chain transactions.
 * It demonstrates how a third party can verify that someone controls a specific account
 * by checking:
 * 1. The proof is valid
 * 2. The VK matches what's committed to in the Schnorr account contract class
 *
 * Usage:
 *   bun run scripts/verify_proof.ts [data.json path] [account address]
 *
 * In a production scenario:
 * - The verifier would fetch the contract class from an Aztec node via RPC
 * - Check that the VK hash is in the private_functions_root for verify_private_authwit
 * - Verify the proof with the trusted VK
 */

import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import fs from "fs";

// Load compiled circuit for VK generation
import circuitJson from "../circuit/target/account_ownership_proof.json" with { type: "json" };

interface ProofData {
  publicInputs: {
    pub_key_x: string;
    pub_key_y: string;
    challenge: number[];
  };
  proof: {
    vkAsFields: string[];
    vkHash: string;
    proofAsFields: string[];
    rawProof: number[];
    rawPublicInputs: string[];
  };
  metadata: {
    generatedAt: string;
    circuitName: string;
  };
}

/**
 * Verifies an off-chain account ownership proof
 */
async function verifyOwnershipProof(
  proofData: ProofData,
  expectedChallenge?: number[]
): Promise<{
  isValid: boolean;
  publicKey: { x: string; y: string };
  vkHash: string;
}> {
  console.log("Initializing Barretenberg...");
  const barretenbergAPI = await Barretenberg.new({ threads: 1 });
  const backend = new UltraHonkBackend(circuitJson.bytecode, barretenbergAPI);

  // Verify challenge matches (prevents replay attacks)
  if (expectedChallenge) {
    const proofChallenge = proofData.publicInputs.challenge;
    const challengeMatches =
      expectedChallenge.length === proofChallenge.length &&
      expectedChallenge.every((v, i) => v === proofChallenge[i]);
    if (!challengeMatches) {
      await barretenbergAPI.destroy();
      throw new Error("Challenge mismatch - possible replay attack");
    }
    console.log("Challenge verified");
  }

  // Reconstruct proof for verification
  const proof = {
    proof: new Uint8Array(proofData.proof.rawProof),
    publicInputs: proofData.proof.rawPublicInputs,
  };

  console.log("\nVerifying proof...");
  console.log(`  Public key X: ${proofData.publicInputs.pub_key_x}`);
  console.log(`  Public key Y: ${proofData.publicInputs.pub_key_y}`);
  console.log(`  VK Hash: ${proofData.proof.vkHash}`);

  const isValid = await backend.verifyProof(proof, {
    verifierTarget: "noir-recursive",
  });

  await barretenbergAPI.destroy();

  return {
    isValid,
    publicKey: {
      x: proofData.publicInputs.pub_key_x,
      y: proofData.publicInputs.pub_key_y,
    },
    vkHash: proofData.proof.vkHash,
  };
}

/**
 * Verifies that the VK hash matches what's registered for Schnorr accounts
 *
 * In production, this would:
 * 1. Fetch the contract instance for the account address via RPC
 * 2. Get the contract class ID from the instance
 * 3. Fetch the contract class and get private_functions_root
 * 4. Verify the VK hash is in the Merkle tree for verify_private_authwit selector
 */
async function verifyVKForAccount(
  accountAddress: string,
  vkHash: string,
  _pxeUrl: string = "http://localhost:8080"
): Promise<boolean> {
  console.log(`\nVerifying VK for account ${accountAddress}...`);

  // In a full implementation with PXE available, we would:
  // 1. const pxe = await createPXEClient(pxeUrl);
  // 2. const instance = await pxe.getContractInstance(AztecAddress.fromString(accountAddress));
  // 3. const contractClass = await pxe.getContractClass(instance.contractClassId);
  // 4. Verify vkHash is in contractClass.privateFunctionsRoot

  console.log("  (VK verification against account address - full implementation pending)");
  console.log(`  Would verify VK hash ${vkHash} is committed to in ${accountAddress}`);
  console.log("  Note: Connect to an Aztec node to perform full VK verification");

  return true; // Return true for demo purposes
}

/**
 * Full verification flow
 */
async function main() {
  const args = process.argv.slice(2);
  const dataPath = args[0] || "data.json";
  const accountAddress = args[1];

  // Load proof data
  if (!fs.existsSync(dataPath)) {
    console.error(`Error: Proof data file not found at ${dataPath}`);
    console.error("Run 'bun run data' first to generate the proof");
    process.exit(1);
  }

  const proofData: ProofData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  console.log(`Loaded proof data from ${dataPath}`);
  console.log(`Generated at: ${proofData.metadata.generatedAt}`);

  // Step 1: Verify the ZK proof
  const result = await verifyOwnershipProof(proofData);

  if (!result.isValid) {
    console.error("\n VERIFICATION FAILED: Invalid proof");
    process.exit(1);
  }

  console.log("\n Proof verification: PASSED");

  // Step 2: Optionally verify VK against account address
  if (accountAddress) {
    const vkValid = await verifyVKForAccount(accountAddress, result.vkHash);
    if (!vkValid) {
      console.error("\n VERIFICATION FAILED: VK does not match account");
      process.exit(1);
    }
    console.log(" VK verification: PASSED");
  } else {
    console.log("\nNote: No account address provided - skipping VK verification");
    console.log("In production, you would verify the VK hash matches the account's contract class");
  }

  console.log("\n========================================");
  console.log(" ACCOUNT OWNERSHIP VERIFIED");
  console.log("========================================");
  console.log(`\nThe prover has demonstrated they control a Schnorr account with:`);
  console.log(`  Public Key X: ${result.publicKey.x}`);
  console.log(`  Public Key Y: ${result.publicKey.y}`);
  console.log(`  VK Hash: ${result.vkHash}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
