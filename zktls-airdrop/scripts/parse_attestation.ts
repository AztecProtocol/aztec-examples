/**
 * parse_attestation.ts
 *
 * Parses a raw Primus zkTLS attestation JSON file (from @primuslabs/zktls-core-sdk)
 * into the typed arrays required by the PrimusAirdrop contract's `claim` function.
 *
 * The core SDK produces plaintext data (not SHA256 hashes). This parser computes
 * SHA256 hashes of the plaintext values to satisfy verify_attestation_hashing's
 * requirement that SHA256(contents[i]) == data_hashes[i].
 *
 * Encoding follows the official att_verifier_parsing library from:
 *   https://github.com/primus-labs/zktls-verification-noir/tree/main/att_verifier_parsing
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import fs from "fs";

// ---- Constants (must match contract globals) ----

export const MAX_URL_LEN = 128;
export const MAX_PLAINTEXT_LEN = 50;
export const NUM_ALLOWED_URLS = 3;

export const GITHUB_API_PREFIX = "https://api.github.com";

export const DEFAULT_ALLOWED_URLS = [
  GITHUB_API_PREFIX,
  GITHUB_API_PREFIX,
  GITHUB_API_PREFIX,
];

// ---- Types (core SDK attestation format) ----

export interface CoreAttestationRequest {
  url: string;
  header: string;
  method: string;
  body: string;
}

export interface CoreResponseResolveItem {
  keyName: string;
  parseType: string;
  parsePath: string;
}

export interface CoreAttestation {
  recipient: string;
  request: CoreAttestationRequest;
  reponseResolve: CoreResponseResolveItem[]; // note: SDK typo "reponse"
  data: string;
  attConditions: string;
  timestamp: number;
  additionParams: string;
  attestors: { attestorAddr: string; url: string }[];
  signatures: string[];
}

export interface ParsedAttestationData {
  publicKeyX: number[];
  publicKeyY: number[];
  hash: number[];
  signature: number[];
  requestUrls: number[][];
  allowedUrls: number[][];
  dataHashes: number[][];
  contents: number[][];
  githubUsername: number[];
  githubId: number[];
}

// ---- Utility functions ----

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// ---- ABI-encode attestation (matches Primus attestor signing format) ----

function encodePacked(att: CoreAttestation): number[] {
  const out: number[] = [];

  // 1. recipient (20 bytes from hex address)
  out.push(...hexToBytes(att.recipient));

  // 2. request: keccak256(url + header + method + body)
  const req = att.request;
  out.push(
    ...keccak_256(stringToBytes(req.url + req.header + req.method + req.body)),
  );

  // 3. responseResolves: keccak256(all keyName+parseType+parsePath concatenated)
  const resolveConcat = att.reponseResolve
    .map((rr) => rr.keyName + rr.parseType + rr.parsePath)
    .join("");
  out.push(...keccak_256(stringToBytes(resolveConcat)));

  // 4. data: raw UTF-8 bytes (NOT hashed)
  out.push(...stringToBytes(att.data));

  // 5. attConditions: raw UTF-8 bytes
  out.push(...stringToBytes(att.attConditions));

  // 6. timestamp: 8 bytes big-endian uint64
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(att.timestamp), false);
  out.push(...new Uint8Array(buf));

  // 7. additionParams: raw UTF-8 bytes
  out.push(...stringToBytes(att.additionParams));

  return out;
}

// ---- Signature utilities ----

function parseSignature(signatureHex: string) {
  const sigHex = signatureHex.startsWith("0x")
    ? signatureHex.slice(2)
    : signatureHex;
  const sigBytes = hexToBytes(sigHex);

  if (sigBytes.length !== 65) {
    throw new Error(
      `Invalid signature length: expected 65, got ${sigBytes.length}`,
    );
  }

  const r = BigInt("0x" + sigHex.slice(0, 64));
  const s = BigInt("0x" + sigHex.slice(64, 128));
  let v = sigBytes[64];
  if (v === 27 || v === 28) v -= 27;

  const sig = new secp256k1.Signature(r, s).addRecoveryBit(v);
  return { sig, compactBytes: Array.from(sig.toCompactRawBytes()) };
}

function recoverPublicKey(
  sig: ReturnType<typeof secp256k1.Signature.prototype.addRecoveryBit>,
  messageHash: Uint8Array,
): { x: number[]; y: number[] } {
  const pubkey = sig.recoverPublicKey(messageHash);
  const pubBytes = pubkey.toRawBytes(false); // uncompressed: 0x04 || x || y
  return {
    x: Array.from(pubBytes.slice(1, 33)),
    y: Array.from(pubBytes.slice(33, 65)),
  };
}

// ---- Main parsing function ----

export function parseAttestation(
  att: CoreAttestation,
  allowedUrls: string[] = DEFAULT_ALLOWED_URLS,
): ParsedAttestationData {
  // 1. Compute keccak256 message hash from packed attestation fields
  const packed = encodePacked(att);
  const msgHash = keccak_256(new Uint8Array(packed));

  // 2. Recover attestor's public key from the first signature
  const { sig, compactBytes } = parseSignature(att.signatures[0]);
  const pubKey = recoverPublicKey(sig, msgHash);

  // 3. Extract request URL (padded to 2 by duplicating, as required by att_verifier_lib)
  const urlBytes = Array.from(stringToBytes(att.request.url));
  const requestUrls = [urlBytes, [...urlBytes]]; // duplicate for 2 required URLs

  // 4. Prepare allowed URL byte arrays
  const allowedUrlArrays = allowedUrls.map((url) =>
    Array.from(stringToBytes(url)),
  );
  while (allowedUrlArrays.length < NUM_ALLOWED_URLS) {
    allowedUrlArrays.push([]);
  }

  // 5. Extract plaintext values from the data field and compute SHA256 hashes.
  //    The core SDK returns plaintext data. att_verifier_lib's verify_attestation_hashing
  //    expects SHA256(contents[i]) == data_hashes[i], so we compute hashes off-chain.
  const dataObj = JSON.parse(att.data);
  const dataHashes: number[][] = [];
  const contents: number[][] = [];

  for (const rr of att.reponseResolve) {
    const plaintext = String(dataObj[rr.keyName]);
    const plaintextBytes = stringToBytes(plaintext);
    contents.push(Array.from(plaintextBytes));
    dataHashes.push(Array.from(sha256(plaintextBytes)));
  }

  // 6. Extract github_username and github_id
  const usernameValue = dataObj["username"];
  const idValue = dataObj["contributor-id"];
  if (usernameValue === undefined || idValue === undefined) {
    throw new Error(
      "Attestation data must contain 'username' and 'contributor-id' keys",
    );
  }

  return {
    publicKeyX: pubKey.x,
    publicKeyY: pubKey.y,
    hash: Array.from(msgHash),
    signature: compactBytes,
    requestUrls,
    allowedUrls: allowedUrlArrays,
    dataHashes,
    contents,
    githubUsername: Array.from(stringToBytes(String(usernameValue))),
    githubId: Array.from(stringToBytes(String(idValue))),
  };
}

// ---- File loader ----

export function parseAttestationFile(
  filePath: string,
  allowedUrls?: string[],
): ParsedAttestationData {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return parseAttestation(raw, allowedUrls);
}
