/**
 * compute_url_hashes.ts
 *
 * Computes the Poseidon2 hashes of allowed URL prefixes for use in the
 * PredictionMarketZkTLS contract constructor. These hashes must match the ones
 * computed inside the att_verifier_lib Noir circuit.
 *
 * Usage:
 *   tsx scripts/compute_url_hashes.ts
 *   tsx scripts/compute_url_hashes.ts "https://api.coingecko.com"
 */

import { Barretenberg } from "@aztec/bb.js";
import { Fr } from "@aztec/aztec.js/fields";
import { DEFAULT_ALLOWED_URLS, MAX_URL_LEN } from "./parse_attestation.js";

/**
 * Compute the Poseidon2 hash of a URL string, matching the att_verifier_lib's
 * internal computation:
 *
 *   let mut hash_input: [Field; MAX_URL_LEN] = [0; MAX_URL_LEN];
 *   for j in 0..MAX_URL_LEN {
 *       if j < allowed_url.len() {
 *           hash_input[j] = allowed_url.storage()[j] as Field;
 *       }
 *   }
 *   Poseidon2::hash(hash_input, MAX_URL_LEN)
 */
export async function computeUrlHash(
  bb: Barretenberg,
  url: string,
): Promise<string> {
  const urlBytes = new TextEncoder().encode(url);
  if (urlBytes.length > MAX_URL_LEN) {
    throw new Error(`URL exceeds MAX_URL_LEN (${MAX_URL_LEN}): ${url}`);
  }

  const inputs: Uint8Array[] = new Array(MAX_URL_LEN).fill(null).map((_, i) => {
    const val = i < urlBytes.length ? BigInt(urlBytes[i]) : 0n;
    return new Fr(val).toBuffer();
  });

  const result = await bb.poseidon2Hash({ inputs });
  return Fr.fromBuffer(Buffer.from(result.hash)).toString();
}

/**
 * Compute the Poseidon2 hash of an attester's public key (x || y), matching
 * the contract's identity check in resolve_market:
 *
 *   let mut key_hash_input: [Field; 64] = [0; 64];
 *   for i in 0..32 {
 *       key_hash_input[i] = public_key_x[i] as Field;
 *       key_hash_input[i + 32] = public_key_y[i] as Field;
 *   }
 *   Poseidon2::hash(key_hash_input, 64)
 */
export async function computeAttesterKeyHash(
  bb: Barretenberg,
  publicKeyX: number[],
  publicKeyY: number[],
): Promise<string> {
  if (publicKeyX.length !== 32 || publicKeyY.length !== 32) {
    throw new Error("Public key components must be 32 bytes each");
  }

  const inputs: Uint8Array[] = new Array(64).fill(null).map((_, i) => {
    const val = i < 32 ? BigInt(publicKeyX[i]) : BigInt(publicKeyY[i - 32]);
    return new Fr(val).toBuffer();
  });

  const result = await bb.poseidon2Hash({ inputs });
  return Fr.fromBuffer(Buffer.from(result.hash)).toString();
}

/**
 * Compute URL hashes for all allowed URLs.
 * Returns hex strings suitable for passing to the contract constructor.
 */
export async function computeAllowedUrlHashes(
  urls: string[] = DEFAULT_ALLOWED_URLS,
): Promise<string[]> {
  const bb = await Barretenberg.new({ threads: 1 });
  try {
    const hashes: string[] = [];
    for (const url of urls) {
      const hash = await computeUrlHash(bb, url);
      hashes.push(hash);
    }
    return hashes;
  } finally {
    await bb.destroy();
  }
}

// CLI entrypoint
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("compute_url_hashes.ts") ||
    process.argv[1].endsWith("compute_url_hashes.js"));

if (isMainModule) {
  const customUrls = process.argv.slice(2);
  const urls = customUrls.length > 0 ? customUrls : DEFAULT_ALLOWED_URLS;

  console.log("Computing Poseidon2 URL hashes for contract deployment...\n");

  const bb = await Barretenberg.new({ threads: 1 });
  for (const url of urls) {
    const hash = await computeUrlHash(bb, url);
    console.log(`  URL:  ${url}`);
    console.log(`  Hash: ${hash}\n`);
  }
  await bb.destroy();
}
