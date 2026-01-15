/**
 * Tests for generic off-chain account ownership proof
 *
 * Tests cover:
 * 1. Schnorr signature proof generation and verification
 * 2. VK membership proof generation and verification
 * 3. Contract class ID computation
 * 4. Full end-to-end verification flow
 */

import { describe, test, before } from "node:test";
import assert from "node:assert";
import { Noir } from "@aztec/noir-noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Schnorr } from "@aztec/foundation/crypto/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { Fr } from "@aztec/foundation/curves/bn254";
import { SchnorrAccountContractArtifact } from "@aztec/accounts/schnorr";
import { randomBytes } from "crypto";

import circuitJson from "../circuit/target/account_ownership_proof.json" with { type: "json" };
import {
  getContractClassWithMembershipProof,
  verifyVkMembershipAndComputeClassId,
  computeContractClassId,
} from "../scripts/utils/contract_class.ts";

describe("Account Ownership Proof", () => {
  let barretenberg: Barretenberg;
  let schnorr: Schnorr;

  before(async () => {
    barretenberg = await Barretenberg.new({ threads: 1 });
    schnorr = new Schnorr();
  });

  describe("Schnorr Signature Proofs", () => {
    test("should generate and verify a valid ownership proof", { timeout: 120000 }, async () => {
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

      assert.strictEqual(isValid, true);
    });

    test("should fail with invalid signature", { timeout: 60000 }, async () => {
      const privateKey = GrumpkinScalar.random();
      const publicKey = await schnorr.computePublicKey(privateKey);
      const challenge = randomBytes(32);
      const invalidSignature = randomBytes(64);

      const inputs = {
        pub_key_x: publicKey.x.toString(),
        pub_key_y: publicKey.y.toString(),
        challenge: Array.from(challenge),
        signature: Array.from(invalidSignature),
      };

      const noir = new Noir(circuitJson as any);

      await assert.rejects(async () => {
        await noir.execute(inputs);
      });
    });

    test("should fail with wrong public key", { timeout: 60000 }, async () => {
      const privateKey1 = GrumpkinScalar.random();
      const privateKey2 = GrumpkinScalar.random();
      const publicKey2 = await schnorr.computePublicKey(privateKey2);
      const challenge = randomBytes(32);

      const signature = await schnorr.constructSignature(challenge, privateKey1);
      const signatureBytes = signature.toBuffer();

      const inputs = {
        pub_key_x: publicKey2.x.toString(),
        pub_key_y: publicKey2.y.toString(),
        challenge: Array.from(challenge),
        signature: Array.from(signatureBytes),
      };

      const noir = new Noir(circuitJson as any);

      await assert.rejects(async () => {
        await noir.execute(inputs);
      });
    });

    test("should fail with wrong challenge", { timeout: 60000 }, async () => {
      const privateKey = GrumpkinScalar.random();
      const publicKey = await schnorr.computePublicKey(privateKey);
      const challenge1 = randomBytes(32);
      const challenge2 = randomBytes(32);

      const signature = await schnorr.constructSignature(challenge1, privateKey);
      const signatureBytes = signature.toBuffer();

      const inputs = {
        pub_key_x: publicKey.x.toString(),
        pub_key_y: publicKey.y.toString(),
        challenge: Array.from(challenge2),
        signature: Array.from(signatureBytes),
      };

      const noir = new Noir(circuitJson as any);

      await assert.rejects(async () => {
        await noir.execute(inputs);
      });
    });
  });

  describe("VK Membership Proofs", () => {
    test("should generate VK membership proof for SchnorrAccount", { timeout: 60000 }, async () => {
      const { contractClass, membershipProof } = await getContractClassWithMembershipProof(
        SchnorrAccountContractArtifact,
        "verify_private_authwit"
      );

      // Verify we got valid data
      assert.ok(contractClass.id, "Contract class ID should exist");
      assert.ok(contractClass.artifactHash, "Artifact hash should exist");
      assert.ok(contractClass.privateFunctionsRoot, "Private functions root should exist");
      assert.ok(contractClass.publicBytecodeCommitment, "Public bytecode commitment should exist");

      // Verify membership proof structure
      assert.ok(membershipProof.selector, "Selector should exist");
      assert.ok(membershipProof.vkHash, "VK hash should exist");
      assert.strictEqual(membershipProof.siblingPath.length, 7, "Sibling path should have 7 elements");
      assert.ok(membershipProof.leafIndex >= 0, "Leaf index should be non-negative");
    });

    test("should verify VK membership and compute correct contract class ID", { timeout: 60000 }, async () => {
      const { contractClass, membershipProof } = await getContractClassWithMembershipProof(
        SchnorrAccountContractArtifact,
        "verify_private_authwit"
      );

      // Create VK membership proof structure for verification
      const vkMembershipProof = {
        leafPreimage: {
          selector: membershipProof.selector.toString(),
          vkHash: membershipProof.vkHash.toString(),
        },
        siblingPath: membershipProof.siblingPath.map((f) => f.toString()),
        leafIndex: membershipProof.leafIndex,
      };

      // Verify membership and compute class ID
      const { computedClassId, computedPrivateFunctionsRoot } =
        await verifyVkMembershipAndComputeClassId(
          vkMembershipProof,
          contractClass.artifactHash.toString(),
          contractClass.publicBytecodeCommitment.toString()
        );

      // Verify the computed values match
      assert.strictEqual(
        computedClassId.toString(),
        contractClass.id.toString(),
        "Computed contract class ID should match"
      );
      assert.strictEqual(
        computedPrivateFunctionsRoot.toString(),
        contractClass.privateFunctionsRoot.toString(),
        "Computed private functions root should match"
      );
    });

    test("should fail verification with tampered VK hash", { timeout: 60000 }, async () => {
      const { contractClass, membershipProof } = await getContractClassWithMembershipProof(
        SchnorrAccountContractArtifact,
        "verify_private_authwit"
      );

      // Create VK membership proof with tampered VK hash
      const tamperedVkMembershipProof = {
        leafPreimage: {
          selector: membershipProof.selector.toString(),
          vkHash: Fr.random().toString(), // Tampered!
        },
        siblingPath: membershipProof.siblingPath.map((f) => f.toString()),
        leafIndex: membershipProof.leafIndex,
      };

      // Verify membership - should compute different class ID
      const { computedClassId } = await verifyVkMembershipAndComputeClassId(
        tamperedVkMembershipProof,
        contractClass.artifactHash.toString(),
        contractClass.publicBytecodeCommitment.toString()
      );

      // The computed class ID should NOT match the original
      assert.notStrictEqual(
        computedClassId.toString(),
        contractClass.id.toString(),
        "Tampered VK hash should produce different contract class ID"
      );
    });

    test("should fail verification with tampered sibling path", { timeout: 60000 }, async () => {
      const { contractClass, membershipProof } = await getContractClassWithMembershipProof(
        SchnorrAccountContractArtifact,
        "verify_private_authwit"
      );

      // Create VK membership proof with tampered sibling path
      const tamperedSiblingPath = membershipProof.siblingPath.map((f) => f.toString());
      tamperedSiblingPath[0] = Fr.random().toString(); // Tamper first element

      const tamperedVkMembershipProof = {
        leafPreimage: {
          selector: membershipProof.selector.toString(),
          vkHash: membershipProof.vkHash.toString(),
        },
        siblingPath: tamperedSiblingPath,
        leafIndex: membershipProof.leafIndex,
      };

      // Verify membership - should compute different class ID
      const { computedClassId } = await verifyVkMembershipAndComputeClassId(
        tamperedVkMembershipProof,
        contractClass.artifactHash.toString(),
        contractClass.publicBytecodeCommitment.toString()
      );

      // The computed class ID should NOT match the original
      assert.notStrictEqual(
        computedClassId.toString(),
        contractClass.id.toString(),
        "Tampered sibling path should produce different contract class ID"
      );
    });
  });

  describe("Contract Class ID Computation", () => {
    test("should compute consistent contract class ID", { timeout: 60000 }, async () => {
      const { contractClass } = await getContractClassWithMembershipProof(
        SchnorrAccountContractArtifact,
        "verify_private_authwit"
      );

      // Compute class ID directly
      const computedId = await computeContractClassId(
        contractClass.artifactHash,
        contractClass.privateFunctionsRoot,
        contractClass.publicBytecodeCommitment
      );

      assert.strictEqual(
        computedId.toString(),
        contractClass.id.toString(),
        "Directly computed class ID should match"
      );
    });

    test("should produce different class ID with different artifact hash", { timeout: 60000 }, async () => {
      const { contractClass } = await getContractClassWithMembershipProof(
        SchnorrAccountContractArtifact,
        "verify_private_authwit"
      );

      // Compute class ID with different artifact hash
      const differentId = await computeContractClassId(
        Fr.random(), // Different artifact hash
        contractClass.privateFunctionsRoot,
        contractClass.publicBytecodeCommitment
      );

      assert.notStrictEqual(
        differentId.toString(),
        contractClass.id.toString(),
        "Different artifact hash should produce different class ID"
      );
    });
  });
});
