/**
 * Generic Off-chain Account Ownership Proof Verifier
 *
 * This script verifies a ZK proof of account ownership completely offline.
 *
 * Verification steps:
 * 1. Verify VK membership in the contract class's privateFunctionsRoot
 * 2. Recompute contract class ID from components to verify it matches
 * 3. Verify the ZK proof
 * 4. Verify the function selector is for verify_private_authwit
 *
 * Usage:
 *   yarn verify [data.json path]
 */

import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import * as fs from "fs";

import { verifyVkMembershipAndComputeClassId } from "./utils/contract_class.ts";
import type { GenericOwnershipProof, VerificationResult } from "./utils/types.ts";

// Load our proof circuit for verification
import circuitJson from "../circuit/target/account_ownership_proof.json" with { type: "json" };

// Known account types and their verify_private_authwit VK hashes
// In production, this would come from a trusted registry
const KNOWN_ACCOUNT_TYPES: Record<string, { name: string; description: string }> = {
  // These will be populated dynamically or from a config file
};

/**
 * Extended proof data that may include debug info
 */
interface ExtendedProofData extends GenericOwnershipProof {
  _debug?: {
    proofCircuitVkHash: string;
    accountVkHash: string;
    privateFunctionsRoot: string;
    publicKey?: { x: string; y: string };
  };
}

/**
 * Verifies the VK membership proof and recomputes the contract class ID
 */
async function verifyVkMembership(proofData: GenericOwnershipProof): Promise<{
  isValid: boolean;
  computedClassId: string;
  computedPrivateFunctionsRoot: string;
  message: string;
}> {
  console.log("\n--- VK Membership Verification ---");

  try {
    const { computedClassId, computedPrivateFunctionsRoot } =
      await verifyVkMembershipAndComputeClassId(
        proofData.vkMembershipProof,
        proofData.contractClass.artifactHash,
        proofData.contractClass.publicBytecodeCommitment
      );

    console.log("Computed Private Functions Root:", computedPrivateFunctionsRoot.toString());
    console.log("Computed Contract Class ID:", computedClassId.toString());
    console.log("Claimed Contract Class ID:", proofData.contractClass.id);

    const classIdMatches = computedClassId.toString() === proofData.contractClass.id;

    if (classIdMatches) {
      console.log("✓ Contract Class ID matches!");
    } else {
      console.log("✗ Contract Class ID MISMATCH!");
    }

    return {
      isValid: classIdMatches,
      computedClassId: computedClassId.toString(),
      computedPrivateFunctionsRoot: computedPrivateFunctionsRoot.toString(),
      message: classIdMatches
        ? "VK membership verified - VK is committed in the claimed contract class"
        : "VK membership verification FAILED - computed class ID doesn't match claimed ID",
    };
  } catch (error) {
    console.log("✗ VK membership verification failed with error:", error);
    return {
      isValid: false,
      computedClassId: "",
      computedPrivateFunctionsRoot: "",
      message: `VK membership verification failed: ${error}`,
    };
  }
}

/**
 * Verifies the function selector is for verify_private_authwit
 */
function verifySelectorIsAuthwit(proofData: GenericOwnershipProof): {
  isValid: boolean;
  message: string;
} {
  console.log("\n--- Selector Verification ---");

  // The function name should be verify_private_authwit
  const expectedFunctionName = "verify_private_authwit";
  const actualFunctionName = proofData.metadata.functionName;

  console.log("Expected function:", expectedFunctionName);
  console.log("Actual function:", actualFunctionName);
  console.log("Selector:", proofData.vkMembershipProof.leafPreimage.selector);

  const isValid = actualFunctionName === expectedFunctionName;

  if (isValid) {
    console.log("✓ Function selector is for verify_private_authwit");
  } else {
    console.log("✗ Function selector is NOT for verify_private_authwit");
  }

  return {
    isValid,
    message: isValid
      ? "Selector verified as verify_private_authwit"
      : `Selector verification failed: expected ${expectedFunctionName}, got ${actualFunctionName}`,
  };
}

/**
 * Verifies the ZK proof using our proof circuit
 */
async function verifyZkProof(
  proofData: GenericOwnershipProof,
  expectedChallenge?: string
): Promise<{
  isValid: boolean;
  message: string;
}> {
  console.log("\n--- ZK Proof Verification ---");

  // Verify challenge if provided
  if (expectedChallenge) {
    if (proofData.challenge !== expectedChallenge) {
      console.log("✗ Challenge mismatch - possible replay attack");
      return {
        isValid: false,
        message: `Challenge mismatch: expected ${expectedChallenge}, got ${proofData.challenge}`,
      };
    }
    console.log("✓ Challenge matches");
  } else {
    console.log("No expected challenge provided - skipping challenge verification");
  }

  console.log("Initializing Barretenberg...");
  const barretenbergAPI = await Barretenberg.new({ threads: 1 });

  try {
    const backend = new UltraHonkBackend(circuitJson.bytecode, barretenbergAPI);

    // Reconstruct proof for verification
    const proof = {
      proof: new Uint8Array(proofData.proof.rawProof),
      publicInputs: proofData.proof.publicInputs,
    };

    console.log("Verifying proof...");
    console.log("  Proof size:", proofData.proof.rawProof.length, "bytes");
    console.log("  Public inputs:", proofData.proof.publicInputs.length);
    console.log("  VK hash:", proofData.vk.hash);

    const isValid = await backend.verifyProof(proof, {
      verifierTarget: "noir-recursive",
    });

    if (isValid) {
      console.log("✓ ZK proof is valid");
    } else {
      console.log("✗ ZK proof is INVALID");
    }

    return {
      isValid,
      message: isValid ? "ZK proof verified successfully" : "ZK proof verification failed",
    };
  } finally {
    await barretenbergAPI.destroy();
  }
}

/**
 * Identifies the account type from the VK hash
 */
function identifyAccountType(vkHash: string): {
  accountType: string | null;
  isKnown: boolean;
  message: string;
} {
  console.log("\n--- Account Type Identification ---");
  console.log("Account VK Hash:", vkHash);

  const knownType = KNOWN_ACCOUNT_TYPES[vkHash];

  if (knownType) {
    console.log(`✓ Known account type: ${knownType.name}`);
    console.log(`  Description: ${knownType.description}`);
    return {
      accountType: knownType.name,
      isKnown: true,
      message: `Known account type: ${knownType.name}`,
    };
  } else {
    console.log("? Account type not in known registry");
    console.log("  The VK membership is still valid, but the account type is unrecognized");
    return {
      accountType: null,
      isKnown: false,
      message: "Account type not in known registry (VK membership still valid)",
    };
  }
}

/**
 * Full verification flow
 */
async function verifyOwnershipProof(
  proofData: ExtendedProofData,
  expectedChallenge?: string
): Promise<VerificationResult> {
  console.log("=".repeat(60));
  console.log("Generic Off-chain Account Ownership Proof Verifier");
  console.log("=".repeat(60));

  // Display proof metadata
  console.log("\nProof Metadata:");
  console.log("  Generated at:", proofData.metadata.generatedAt);
  console.log("  Account type claim:", proofData.metadata.accountType || "not specified");
  console.log("  Function:", proofData.metadata.functionName);
  console.log("  Challenge:", proofData.challenge);

  if (proofData._debug) {
    console.log("\nDebug Info:");
    console.log("  Proof circuit VK hash:", proofData._debug.proofCircuitVkHash);
    console.log("  Account VK hash:", proofData._debug.accountVkHash);
    console.log("  Private functions root:", proofData._debug.privateFunctionsRoot);
    if (proofData._debug.publicKey) {
      console.log("  Public key X:", proofData._debug.publicKey.x);
      console.log("  Public key Y:", proofData._debug.publicKey.y);
    }
  }

  // Step 1: Verify VK membership
  console.log("\n" + "=".repeat(60));
  console.log("Step 1: Verifying VK Membership in Contract Class");
  console.log("=".repeat(60));
  const vkResult = await verifyVkMembership(proofData);

  // Step 2: Verify selector
  console.log("\n" + "=".repeat(60));
  console.log("Step 2: Verifying Function Selector");
  console.log("=".repeat(60));
  const selectorResult = verifySelectorIsAuthwit(proofData);

  // Step 3: Verify ZK proof
  console.log("\n" + "=".repeat(60));
  console.log("Step 3: Verifying ZK Proof");
  console.log("=".repeat(60));
  const proofResult = await verifyZkProof(proofData, expectedChallenge);

  // Step 4: Identify account type (informational)
  console.log("\n" + "=".repeat(60));
  console.log("Step 4: Identifying Account Type");
  console.log("=".repeat(60));
  const accountTypeResult = identifyAccountType(
    proofData.vkMembershipProof.leafPreimage.vkHash
  );

  // Final result
  const allValid = vkResult.isValid && selectorResult.isValid && proofResult.isValid;

  const result: VerificationResult = {
    isValid: allValid,
    contractClassId: proofData.contractClass.id,
    message: allValid
      ? `Verified: Prover controls an account of contract class ${proofData.contractClass.id}`
      : "Verification FAILED",
    details: {
      vkMembershipValid: vkResult.isValid,
      contractClassIdValid: vkResult.isValid,
      proofValid: proofResult.isValid,
      selectorValid: selectorResult.isValid,
    },
  };

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("VERIFICATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`VK Membership:     ${vkResult.isValid ? "✓ PASSED" : "✗ FAILED"}`);
  console.log(`Selector Check:    ${selectorResult.isValid ? "✓ PASSED" : "✗ FAILED"}`);
  console.log(`ZK Proof:          ${proofResult.isValid ? "✓ PASSED" : "✗ FAILED"}`);
  console.log(`Account Type:      ${accountTypeResult.isKnown ? accountTypeResult.accountType : "Unknown (not in registry)"}`);
  console.log("".padStart(60, "-"));
  console.log(`OVERALL:           ${allValid ? "✓ VERIFIED" : "✗ FAILED"}`);

  if (allValid) {
    console.log("\n" + "=".repeat(60));
    console.log("✓ ACCOUNT OWNERSHIP VERIFIED");
    console.log("=".repeat(60));
    console.log("\nThe prover has demonstrated they control an account of:");
    console.log(`  Contract Class ID: ${proofData.contractClass.id}`);
    console.log(`  Account Type: ${proofData.metadata.accountType || "unknown"}`);
    console.log(`  VK Hash: ${proofData.vkMembershipProof.leafPreimage.vkHash}`);
    console.log("\nThis verification was performed completely offline.");
    console.log("No Aztec node queries were required.");
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const dataPath = args[0] || "data.json";
  const expectedChallenge = args[1]; // Optional

  // Load proof data
  if (!fs.existsSync(dataPath)) {
    console.error(`Error: Proof data file not found at ${dataPath}`);
    console.error("Run 'yarn data' first to generate the proof");
    process.exit(1);
  }

  const proofData: ExtendedProofData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  console.log(`Loaded proof data from ${dataPath}`);

  // Run verification
  const result = await verifyOwnershipProof(proofData, expectedChallenge);

  // Exit with appropriate code
  process.exit(result.isValid ? 0 : 1);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
