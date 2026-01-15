/**
 * Off-chain Account Ownership Proof Generator
 *
 * This script generates a ZK proof that demonstrates ownership of an Aztec account
 * by proving knowledge of a valid Schnorr signature without revealing the private key.
 *
 * Usage:
 *   bun run scripts/generate_proof.ts
 *
 * The script will:
 * 1. Generate or load a signing key pair
 * 2. Create a random challenge (to prevent replay attacks)
 * 3. Sign the challenge with the private key
 * 4. Generate a ZK proof of valid signature
 * 5. Output proof data to data.json
 */

import { Noir } from "@aztec/noir-noir_js";
import { Barretenberg, UltraHonkBackend, deflattenFields } from "@aztec/bb.js";
import { Schnorr } from "@aztec/foundation/crypto/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { randomBytes } from "crypto";
import fs from "fs";

// Load compiled circuit
import circuitJson from "../circuit/target/account_ownership_proof.json" with { type: "json" };

async function main() {
  console.log("Initializing Barretenberg...");
  const barretenbergAPI = await Barretenberg.new({ threads: 1 });

  // Initialize Schnorr signer
  const schnorr = new Schnorr();

  // Generate or use existing signing key
  // In production, this would be loaded from secure storage
  const signingPrivateKey = GrumpkinScalar.random();
  console.log("Generated signing private key");

  // Compute public key from private key
  const signingPublicKey = await schnorr.computePublicKey(signingPrivateKey);
  console.log("Public key X:", signingPublicKey.x.toString());
  console.log("Public key Y:", signingPublicKey.y.toString());

  // Generate a random 32-byte challenge
  // In production, this should be provided by the verifier
  const challenge = randomBytes(32);
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

  console.log("\nExecuting circuit...");
  const noir = new Noir(circuitJson as any);
  const { witness } = await noir.execute(circuitInputs);
  console.log("Circuit execution successful");

  // Generate proof
  console.log("\nGenerating proof...");
  const backend = new UltraHonkBackend(circuitJson.bytecode, barretenbergAPI);
  const proofData = await backend.generateProof(witness, {
    verifierTarget: "noir-recursive",
  });
  console.log("Proof generated successfully");

  // Verify the proof locally
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

  // Convert proof to fields if needed
  let proofAsFields = recursiveArtifacts.proofAsFields;
  if (proofAsFields.length === 0) {
    console.log("Using deflattenFields to convert proof...");
    proofAsFields = deflattenFields(proofData.proof).map((f) => f.toString());
  }

  const vkAsFields = recursiveArtifacts.vkAsFields;

  console.log(`\nProof stats:`);
  console.log(`  VK size: ${vkAsFields.length} fields`);
  console.log(`  Proof size: ${proofAsFields.length} fields`);
  console.log(`  Public inputs: ${proofData.publicInputs.length}`);

  // Prepare output data
  const outputData = {
    // Public inputs (visible to verifier)
    publicInputs: {
      pub_key_x: signingPublicKey.x.toString(),
      pub_key_y: signingPublicKey.y.toString(),
      challenge: Array.from(challenge),
    },
    // Proof data
    proof: {
      vkAsFields: vkAsFields,
      vkHash: recursiveArtifacts.vkHash,
      proofAsFields: proofAsFields,
      rawProof: Array.from(proofData.proof),
      rawPublicInputs: proofData.publicInputs.map((p) => p.toString()),
    },
    // Metadata for verification
    metadata: {
      generatedAt: new Date().toISOString(),
      circuitName: "account_ownership_proof",
    },
  };

  // Write to file
  const outputPath = "data.json";
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\nProof data written to ${outputPath}`);

  // Cleanup
  await barretenbergAPI.destroy();
  console.log("\nDone!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
