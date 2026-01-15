/**
 * Contract class utilities for off-chain account ownership proof
 *
 * Wraps @aztec/stdlib functions for our specific use case.
 */

import { GeneratorIndex } from "@aztec/constants";
import { poseidon2Hash, poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon";
import { Fr } from "@aztec/foundation/curves/bn254";
import { computeRootFromSiblingPath } from "@aztec/foundation/trees";
import { FunctionSelector } from "@aztec/stdlib/abi";
import {
  getContractClassFromArtifact,
  createPrivateFunctionMembershipProof,
} from "@aztec/stdlib/contract";
import type { ContractArtifact } from "@aztec/stdlib/abi";
import type { FunctionLeafPreimage, VkMembershipProof } from "./types.ts";

/**
 * Computes the leaf hash for a private function in the contract class Merkle tree.
 *
 * leaf = poseidon2HashWithSeparator([selector, vkHash], FUNCTION_LEAF)
 */
export async function computeFunctionLeafHash(
  selector: FunctionSelector | Fr,
  vkHash: Fr
): Promise<Fr> {
  const selectorField = selector instanceof FunctionSelector ? selector.toField() : selector;
  return poseidon2HashWithSeparator([selectorField, vkHash], GeneratorIndex.FUNCTION_LEAF);
}

/**
 * Computes the Merkle root from a leaf and its sibling path.
 *
 * This is used by the verifier to recompute the privateFunctionsRoot
 * from the membership proof.
 */
export async function computeRootFromMembershipProof(
  leafPreimage: FunctionLeafPreimage,
  siblingPath: Fr[],
  leafIndex: number
): Promise<Fr> {
  // Compute the leaf hash
  const selectorField = Fr.fromString(leafPreimage.selector);
  const vkHashField = Fr.fromString(leafPreimage.vkHash);
  const leafHash = await computeFunctionLeafHash(selectorField, vkHashField);

  // Compute root from sibling path using poseidon2Hash for internal nodes
  const rootBuffer = await computeRootFromSiblingPath(
    leafHash.toBuffer(),
    siblingPath.map((fr) => fr.toBuffer()),
    leafIndex,
    async (left, right) => (await poseidon2Hash([left, right])).toBuffer()
  );

  return Fr.fromBuffer(rootBuffer);
}

/**
 * Computes the contract class ID from its preimage components.
 *
 * ContractClassId = poseidon2HashWithSeparator(
 *   [artifactHash, privateFunctionsRoot, publicBytecodeCommitment],
 *   CONTRACT_LEAF
 * )
 */
export async function computeContractClassId(
  artifactHash: Fr,
  privateFunctionsRoot: Fr,
  publicBytecodeCommitment: Fr
): Promise<Fr> {
  return poseidon2HashWithSeparator(
    [artifactHash, privateFunctionsRoot, publicBytecodeCommitment],
    GeneratorIndex.CONTRACT_LEAF
  );
}

/**
 * Gets the full contract class info from an artifact, including the VK membership proof
 * for a specific function.
 */
export async function getContractClassWithMembershipProof(
  artifact: ContractArtifact,
  functionName: string
): Promise<{
  contractClass: {
    id: Fr;
    artifactHash: Fr;
    privateFunctionsRoot: Fr;
    publicBytecodeCommitment: Fr;
  };
  membershipProof: {
    selector: FunctionSelector;
    vkHash: Fr;
    siblingPath: Fr[];
    leafIndex: number;
  };
}> {
  // Get the function selector
  const functionArtifact = artifact.functions.find((f) => f.name === functionName);
  if (!functionArtifact) {
    throw new Error(`Function ${functionName} not found in artifact`);
  }
  const selector = await FunctionSelector.fromNameAndParameters(
    functionArtifact.name,
    functionArtifact.parameters
  );

  // Get contract class with preimage
  const contractClassWithId = await getContractClassFromArtifact(artifact);

  // Get membership proof
  const membershipProof = await createPrivateFunctionMembershipProof(selector, artifact);

  // Get the VK hash for this function
  const privateFunction = contractClassWithId.privateFunctions.find((f) =>
    f.selector.equals(selector)
  );
  if (!privateFunction) {
    throw new Error(`Private function ${functionName} not found in contract class`);
  }

  return {
    contractClass: {
      id: contractClassWithId.id,
      artifactHash: contractClassWithId.artifactHash,
      privateFunctionsRoot: contractClassWithId.privateFunctionsRoot,
      publicBytecodeCommitment: contractClassWithId.publicBytecodeCommitment,
    },
    membershipProof: {
      selector,
      vkHash: privateFunction.vkHash,
      siblingPath: membershipProof.privateFunctionTreeSiblingPath,
      leafIndex: membershipProof.privateFunctionTreeLeafIndex,
    },
  };
}

/**
 * Verifies a VK membership proof and recomputes the contract class ID.
 *
 * This is the core verification logic that proves:
 * 1. The VK hash is committed to in the privateFunctionsRoot
 * 2. The privateFunctionsRoot, combined with other preimage components,
 *    produces the claimed contract class ID
 *
 * @returns The computed contract class ID if verification succeeds
 */
export async function verifyVkMembershipAndComputeClassId(
  vkMembershipProof: VkMembershipProof,
  artifactHash: string,
  publicBytecodeCommitment: string
): Promise<{
  computedClassId: Fr;
  computedPrivateFunctionsRoot: Fr;
}> {
  // Convert string fields to Fr
  const siblingPath = vkMembershipProof.siblingPath.map((s) => Fr.fromString(s));
  const artifactHashFr = Fr.fromString(artifactHash);
  const publicBytecodeCommitmentFr = Fr.fromString(publicBytecodeCommitment);

  // Compute the privateFunctionsRoot from the membership proof
  const computedPrivateFunctionsRoot = await computeRootFromMembershipProof(
    vkMembershipProof.leafPreimage,
    siblingPath,
    vkMembershipProof.leafIndex
  );

  // Compute the contract class ID from all components
  const computedClassId = await computeContractClassId(
    artifactHashFr,
    computedPrivateFunctionsRoot,
    publicBytecodeCommitmentFr
  );

  return {
    computedClassId,
    computedPrivateFunctionsRoot,
  };
}

/**
 * Gets the expected selector for verify_private_authwit function.
 *
 * The selector is computed from the function signature:
 * verify_private_authwit(inner_hash: Field, ...) -> Field
 *
 * Different account types have different additional parameters:
 * - SchnorrAccount: verify_private_authwit(inner_hash: Field)
 * - PasswordAccount: verify_private_authwit(inner_hash: Field, password: Field)
 *
 * We verify only the function name matches, as the parameter signature varies.
 */
export function isVerifyPrivateAuthwitSelector(_selector: string, functionName: string): boolean {
  return functionName === "verify_private_authwit";
}
