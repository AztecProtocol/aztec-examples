/**
 * Type definitions for generic off-chain account ownership proof
 */

/**
 * Contract class preimage - components used to compute the contract class ID
 */
export interface ContractClassPreimage {
  /** Hash of the contract artifact */
  artifactHash: string;
  /** Root of the Merkle tree of private function VK hashes */
  privateFunctionsRoot: string;
  /** Commitment to public bytecode */
  publicBytecodeCommitment: string;
}

/**
 * Leaf preimage for a private function in the contract class
 */
export interface FunctionLeafPreimage {
  /** Function selector (4-byte identifier) */
  selector: string;
  /** Hash of the function's verification key */
  vkHash: string;
}

/**
 * Merkle membership proof for a VK in the privateFunctionsRoot
 */
export interface VkMembershipProof {
  /** The leaf data being proven */
  leafPreimage: FunctionLeafPreimage;
  /** Sibling path for Merkle proof (7 elements for tree height 7) */
  siblingPath: string[];
  /** Index of the leaf in the tree */
  leafIndex: number;
}

/**
 * Generic ownership proof data structure
 *
 * This contains everything needed for offline verification:
 * - Contract class identification (verifier recomputes ID from components)
 * - ZK proof of authorization
 * - Verification key and its membership proof
 */
export interface GenericOwnershipProof {
  /** Contract class identification */
  contractClass: {
    /** Claimed contract class ID (verifier will recompute to verify) */
    id: string;
    /** Hash of contract artifact */
    artifactHash: string;
    /** Commitment to public bytecode */
    publicBytecodeCommitment: string;
    // Note: privateFunctionsRoot is NOT included - verifier computes it from Merkle proof
  };

  /** ZK Proof data */
  proof: {
    /** Raw proof bytes */
    rawProof: number[];
    /** Public inputs to the circuit */
    publicInputs: string[];
  };

  /** Verification Key */
  vk: {
    /** VK as field elements */
    asFields: string[];
    /** Hash of the VK */
    hash: string;
  };

  /** VK membership proof (proves VK is committed in privateFunctionsRoot) */
  vkMembershipProof: VkMembershipProof;

  /** Challenge that was proven (public input) */
  challenge: string;

  /** Metadata */
  metadata: {
    /** When the proof was generated */
    generatedAt: string;
    /** Account type hint (e.g., "SchnorrAccount", "PasswordAccount") */
    accountType?: string;
    /** Name of the function proven */
    functionName: string;
  };
}

/**
 * Result of proof verification
 */
export interface VerificationResult {
  /** Whether the proof is valid */
  isValid: boolean;
  /** The verified contract class ID */
  contractClassId: string;
  /** Human-readable message */
  message: string;
  /** Detailed verification steps */
  details?: {
    vkMembershipValid: boolean;
    contractClassIdValid: boolean;
    proofValid: boolean;
    selectorValid: boolean;
  };
}
