/**
 * Generic Off-chain Account Ownership Proof Generator
 *
 * This script generates a ZK proof that demonstrates ownership of an Aztec account
 * by proving knowledge of the account's authentication secret.
 *
 * Architecture:
 * 1. Generate proof of auth secret knowledge (e.g., Schnorr signature)
 * 2. Generate VK membership proof from the actual account contract artifact
 * 3. Output everything for offline verification
 *
 * The verifier can then:
 * 1. Verify the ZK proof
 * 2. Verify VK membership in the contract class
 * 3. Confirm the auth type matches the proof type
 *
 * Usage:
 *   yarn data [--account-type schnorr|password]
 */

import { Noir } from "@aztec/noir-noir_js";
import { Barretenberg, UltraHonkBackend, deflattenFields } from "@aztec/bb.js";
import { Schnorr } from "@aztec/foundation/crypto/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { SchnorrAccountContractArtifact } from "@aztec/accounts/schnorr";
import { randomBytes } from "crypto";
import fs from "fs";

import { getContractClassWithMembershipProof } from "./utils/contract_class.ts";
import type { GenericOwnershipProof } from "./utils/types.ts";

// Load our proof-of-ownership circuit (proves Schnorr signature knowledge)
import circuitJson from "../circuit/target/account_ownership_proof.json" with { type: "json" };

interface ProofGenerationOptions {
  accountType: "schnorr" | "password";
  challenge?: Buffer;
  signingPrivateKey?: GrumpkinScalar;
  password?: string;
}

/**
 * Generate proof for Schnorr account type
 */
async function generateSchnorrProof(
  barretenbergAPI: Barretenberg,
  options: ProofGenerationOptions
) {
  const schnorr = new Schnorr();

  // Generate or use provided signing key
  const signingPrivateKey = options.signingPrivateKey ?? GrumpkinScalar.random();
  console.log("Using Schnorr signing key");

  // Compute public key
  const signingPublicKey = await schnorr.computePublicKey(signingPrivateKey);
  console.log("Public key X:", signingPublicKey.x.toString());
  console.log("Public key Y:", signingPublicKey.y.toString());

  // Generate or use provided challenge
  const challenge = options.challenge ?? randomBytes(32);
  console.log("Challenge:", challenge.toString("hex"));

  // Sign the challenge
  const signature = await schnorr.constructSignature(challenge, signingPrivateKey);
  const signatureBytes = signature.toBuffer();
  console.log("Signature generated:", signatureBytes.length, "bytes");

  // Prepare circuit inputs
  const circuitInputs = {
    pub_key_x: signingPublicKey.x.toString(),
    pub_key_y: signingPublicKey.y.toString(),
    challenge: Array.from(challenge),
    signature: Array.from(signatureBytes),
  };

  // Execute circuit
  console.log("\nExecuting Schnorr verification circuit...");
  const noir = new Noir(circuitJson as any);
  const { witness } = await noir.execute(circuitInputs);
  console.log("Circuit execution successful");

  // Generate proof
  console.log("\nGenerating ZK proof...");
  const backend = new UltraHonkBackend(circuitJson.bytecode, barretenbergAPI);
  const proofData = await backend.generateProof(witness, {
    verifierTarget: "noir-recursive",
  });
  console.log("Proof generated successfully");

  // Verify locally
  console.log("\nVerifying proof locally...");
  const isValid = await backend.verifyProof(proofData, {
    verifierTarget: "noir-recursive",
  });
  console.log(`Local verification: ${isValid ? "SUCCESS" : "FAILED"}`);

  if (!isValid) {
    throw new Error("Proof verification failed locally");
  }

  // Generate recursive proof artifacts
  const recursiveArtifacts = await backend.generateRecursiveProofArtifacts(
    proofData.proof,
    proofData.publicInputs.length
  );

  let proofAsFields = recursiveArtifacts.proofAsFields;
  if (proofAsFields.length === 0) {
    proofAsFields = deflattenFields(proofData.proof).map((f) => f.toString());
  }

  return {
    proof: {
      rawProof: Array.from(proofData.proof),
      publicInputs: proofData.publicInputs.map((p) => p.toString()),
    },
    vk: {
      asFields: recursiveArtifacts.vkAsFields,
      hash: recursiveArtifacts.vkHash,
    },
    challenge: challenge.toString("hex"),
    publicKey: {
      x: signingPublicKey.x.toString(),
      y: signingPublicKey.y.toString(),
    },
  };
}

/**
 * Get VK membership proof from the account contract artifact
 */
async function getAccountVkMembershipProof(accountType: "schnorr" | "password") {
  console.log(`\nGetting VK membership proof for ${accountType} account...`);

  let artifact;
  switch (accountType) {
    case "schnorr":
      artifact = SchnorrAccountContractArtifact;
      break;
    case "password":
      // TODO: Load PasswordAccount artifact when available
      throw new Error("Password account type not yet implemented");
    default:
      throw new Error(`Unknown account type: ${accountType}`);
  }

  // Get contract class info and VK membership proof
  const { contractClass, membershipProof } = await getContractClassWithMembershipProof(
    artifact,
    "verify_private_authwit"
  );

  console.log("Contract Class ID:", contractClass.id.toString());
  console.log("Artifact Hash:", contractClass.artifactHash.toString());
  console.log("Private Functions Root:", contractClass.privateFunctionsRoot.toString());
  console.log("Public Bytecode Commitment:", contractClass.publicBytecodeCommitment.toString());
  console.log("Function Selector:", membershipProof.selector.toString());
  console.log("VK Hash:", membershipProof.vkHash.toString());
  console.log("Merkle Path Length:", membershipProof.siblingPath.length);
  console.log("Leaf Index:", membershipProof.leafIndex);

  return {
    contractClass: {
      id: contractClass.id.toString(),
      artifactHash: contractClass.artifactHash.toString(),
      publicBytecodeCommitment: contractClass.publicBytecodeCommitment.toString(),
    },
    vkMembershipProof: {
      leafPreimage: {
        selector: membershipProof.selector.toString(),
        vkHash: membershipProof.vkHash.toString(),
      },
      siblingPath: membershipProof.siblingPath.map((f) => f.toString()),
      leafIndex: membershipProof.leafIndex,
    },
    // Also return the privateFunctionsRoot for verification
    privateFunctionsRoot: contractClass.privateFunctionsRoot.toString(),
  };
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let accountType: "schnorr" | "password" = "schnorr";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--account-type" && args[i + 1]) {
      accountType = args[i + 1] as "schnorr" | "password";
      i++;
    }
  }

  console.log("=".repeat(60));
  console.log("Generic Off-chain Account Ownership Proof Generator");
  console.log("=".repeat(60));
  console.log(`Account Type: ${accountType}`);

  console.log("\nInitializing Barretenberg...");
  const barretenbergAPI = await Barretenberg.new({ threads: 1 });

  try {
    // Step 1: Generate proof of auth secret knowledge
    console.log("\n" + "=".repeat(60));
    console.log("Step 1: Generating proof of authentication secret knowledge");
    console.log("=".repeat(60));

    let proofResult;
    switch (accountType) {
      case "schnorr":
        proofResult = await generateSchnorrProof(barretenbergAPI, { accountType });
        break;
      case "password":
        throw new Error("Password account type not yet implemented");
      default:
        throw new Error(`Unknown account type: ${accountType}`);
    }

    // Step 2: Get VK membership proof from account contract
    console.log("\n" + "=".repeat(60));
    console.log("Step 2: Getting VK membership proof from account contract");
    console.log("=".repeat(60));

    const membershipData = await getAccountVkMembershipProof(accountType);

    // Step 3: Assemble final proof data
    console.log("\n" + "=".repeat(60));
    console.log("Step 3: Assembling proof data");
    console.log("=".repeat(60));

    const outputData: GenericOwnershipProof = {
      contractClass: membershipData.contractClass,
      proof: proofResult.proof,
      vk: proofResult.vk,
      vkMembershipProof: membershipData.vkMembershipProof,
      challenge: proofResult.challenge,
      metadata: {
        generatedAt: new Date().toISOString(),
        accountType,
        functionName: "verify_private_authwit",
      },
    };

    // Also include some additional data for debugging/display
    const extendedOutput = {
      ...outputData,
      // Additional data not part of GenericOwnershipProof but useful for display
      _debug: {
        proofCircuitVkHash: proofResult.vk.hash,
        accountVkHash: membershipData.vkMembershipProof.leafPreimage.vkHash,
        privateFunctionsRoot: membershipData.privateFunctionsRoot,
        publicKey: proofResult.publicKey,
      },
    };

    // Write to file
    const outputPath = "data.json";
    fs.writeFileSync(outputPath, JSON.stringify(extendedOutput, null, 2));
    console.log(`\nProof data written to ${outputPath}`);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Account Type: ${accountType}`);
    console.log(`Contract Class ID: ${membershipData.contractClass.id}`);
    console.log(`Proof VK Hash: ${proofResult.vk.hash}`);
    console.log(`Account VK Hash: ${membershipData.vkMembershipProof.leafPreimage.vkHash}`);
    console.log(`Challenge: ${proofResult.challenge}`);
    console.log("\nNote: The Proof VK Hash is from our proof circuit.");
    console.log("The Account VK Hash is from the account's verify_private_authwit function.");
    console.log("The verifier uses the VK membership proof to confirm the account type.");
  } finally {
    await barretenbergAPI.destroy();
  }

  console.log("\nDone!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
