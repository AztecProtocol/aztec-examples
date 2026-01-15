/**
 * Tests for off-chain account ownership proof
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { Noir } from "@aztec/noir-noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Schnorr } from "@aztec/foundation/crypto/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { randomBytes } from "crypto";

import circuitJson from "../circuit/target/account_ownership_proof.json" with { type: "json" };

describe("Account Ownership Proof", () => {
  let barretenberg: Barretenberg;
  let schnorr: Schnorr;

  beforeAll(async () => {
    barretenberg = await Barretenberg.new({ threads: 1 });
    schnorr = new Schnorr();
  });

  test("should generate and verify a valid ownership proof", async () => {
    // Generate key pair
    const privateKey = GrumpkinScalar.random();
    const publicKey = await schnorr.computePublicKey(privateKey);

    // Generate challenge
    const challenge = randomBytes(32);

    // Sign the challenge
    const signature = await schnorr.constructSignature(challenge, privateKey);
    const signatureBytes = signature.toBuffer();

    // Prepare circuit inputs
    const inputs = {
      pub_key_x: publicKey.x.toString(),
      pub_key_y: publicKey.y.toString(),
      challenge: Array.from(challenge),
      signature: Array.from(signatureBytes),
    };

    // Execute circuit
    const noir = new Noir(circuitJson as any);
    const { witness } = await noir.execute(inputs);

    // Generate proof
    const backend = new UltraHonkBackend(circuitJson.bytecode, barretenberg);
    const proofData = await backend.generateProof(witness, {
      verifierTarget: "noir-recursive",
    });

    // Verify proof
    const isValid = await backend.verifyProof(proofData, {
      verifierTarget: "noir-recursive",
    });

    expect(isValid).toBe(true);
  }, 120000); // 2 minute timeout for proof generation

  test("should fail with invalid signature", async () => {
    // Generate key pair
    const privateKey = GrumpkinScalar.random();
    const publicKey = await schnorr.computePublicKey(privateKey);

    // Generate challenge
    const challenge = randomBytes(32);

    // Create an invalid signature (random bytes)
    const invalidSignature = randomBytes(64);

    // Prepare circuit inputs with invalid signature
    const inputs = {
      pub_key_x: publicKey.x.toString(),
      pub_key_y: publicKey.y.toString(),
      challenge: Array.from(challenge),
      signature: Array.from(invalidSignature),
    };

    // Execute circuit - should fail
    const noir = new Noir(circuitJson as any);

    await expect(noir.execute(inputs)).rejects.toThrow();
  }, 60000);

  test("should fail with wrong public key", async () => {
    // Generate two different key pairs
    const privateKey1 = GrumpkinScalar.random();
    const privateKey2 = GrumpkinScalar.random();
    const publicKey2 = await schnorr.computePublicKey(privateKey2);

    // Generate challenge
    const challenge = randomBytes(32);

    // Sign with privateKey1
    const signature = await schnorr.constructSignature(challenge, privateKey1);
    const signatureBytes = signature.toBuffer();

    // Try to verify with publicKey2 (wrong key)
    const inputs = {
      pub_key_x: publicKey2.x.toString(),
      pub_key_y: publicKey2.y.toString(),
      challenge: Array.from(challenge),
      signature: Array.from(signatureBytes),
    };

    // Execute circuit - should fail
    const noir = new Noir(circuitJson as any);

    await expect(noir.execute(inputs)).rejects.toThrow();
  }, 60000);

  test("should fail with wrong challenge", async () => {
    // Generate key pair
    const privateKey = GrumpkinScalar.random();
    const publicKey = await schnorr.computePublicKey(privateKey);

    // Generate two different challenges
    const challenge1 = randomBytes(32);
    const challenge2 = randomBytes(32);

    // Sign challenge1
    const signature = await schnorr.constructSignature(challenge1, privateKey);
    const signatureBytes = signature.toBuffer();

    // Try to verify with challenge2 (wrong challenge)
    const inputs = {
      pub_key_x: publicKey.x.toString(),
      pub_key_y: publicKey.y.toString(),
      challenge: Array.from(challenge2),
      signature: Array.from(signatureBytes),
    };

    // Execute circuit - should fail
    const noir = new Noir(circuitJson as any);

    await expect(noir.execute(inputs)).rejects.toThrow();
  }, 60000);
});
