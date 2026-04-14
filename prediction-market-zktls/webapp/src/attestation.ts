/**
 * Browser-compatible attestation parser.
 * Adapted from scripts/parse_attestation.ts — uses no Node.js APIs.
 */

import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { sha256 } from '@noble/hashes/sha256'

export const MAX_URL_LEN = 128
export const MAX_PLAINTEXT_LEN = 50
export const NUM_ALLOWED_URLS = 3

export const COINGECKO_API_PREFIX = 'https://api.coingecko.com'
export const DEFAULT_ALLOWED_URLS = [COINGECKO_API_PREFIX, COINGECKO_API_PREFIX, COINGECKO_API_PREFIX]

interface CoreAttestationRequest {
  url: string
  header: string
  method: string
  body: string
}

interface CoreResponseResolveItem {
  keyName: string
  parseType: string
  parsePath: string
}

interface CoreAttestation {
  recipient: string
  request: CoreAttestationRequest
  reponseResolve: CoreResponseResolveItem[]
  data: string
  attConditions: string
  timestamp: number
  additionParams: string
  attestors: { attestorAddr: string; url: string }[]
  signatures: string[]
}

export interface ParsedAttestationData {
  publicKeyX: number[]
  publicKeyY: number[]
  hash: number[]
  signature: number[]
  requestUrls: number[][]
  allowedUrls: number[][]
  dataHashes: number[][]
  contents: number[][]
  priceBytes: number[]
  priceConfirmBytes: number[]
  timestamp: bigint
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function encodePacked(att: CoreAttestation): number[] {
  const out: number[] = []
  out.push(...hexToBytes(att.recipient))
  const req = att.request
  out.push(...keccak_256(stringToBytes(req.url + req.header + req.method + req.body)))
  const resolveConcat = att.reponseResolve.map((rr) => rr.keyName + rr.parseType + rr.parsePath).join('')
  out.push(...keccak_256(stringToBytes(resolveConcat)))
  out.push(...stringToBytes(att.data))
  out.push(...stringToBytes(att.attConditions))
  const buf = new ArrayBuffer(8)
  new DataView(buf).setBigUint64(0, BigInt(att.timestamp), false)
  out.push(...new Uint8Array(buf))
  out.push(...stringToBytes(att.additionParams))
  return out
}

function parseSignature(signatureHex: string) {
  const sigHex = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex
  const sigBytes = hexToBytes(sigHex)
  if (sigBytes.length !== 65) throw new Error(`Invalid signature length: expected 65, got ${sigBytes.length}`)
  const r = BigInt('0x' + sigHex.slice(0, 64))
  const s = BigInt('0x' + sigHex.slice(64, 128))
  let v = sigBytes[64]
  if (v === 27 || v === 28) v -= 27
  const sig = new secp256k1.Signature(r, s).addRecoveryBit(v)
  return { sig, compactBytes: Array.from(sig.toCompactRawBytes()) }
}

function recoverPublicKey(
  sig: ReturnType<typeof secp256k1.Signature.prototype.addRecoveryBit>,
  messageHash: Uint8Array,
): { x: number[]; y: number[] } {
  const pubkey = sig.recoverPublicKey(messageHash)
  const pubBytes = pubkey.toRawBytes(false)
  return {
    x: Array.from(pubBytes.slice(1, 33)),
    y: Array.from(pubBytes.slice(33, 65)),
  }
}

export function parseAttestation(
  att: CoreAttestation,
  allowedUrls: string[] = DEFAULT_ALLOWED_URLS,
): ParsedAttestationData {
  const packed = encodePacked(att)
  const msgHash = keccak_256(new Uint8Array(packed))
  const { sig, compactBytes } = parseSignature(att.signatures[0])
  const pubKey = recoverPublicKey(sig, msgHash)
  const urlBytes = Array.from(stringToBytes(att.request.url))
  const requestUrls = [urlBytes, [...urlBytes]]
  const allowedUrlArrays = allowedUrls.map((url) => Array.from(stringToBytes(url)))
  while (allowedUrlArrays.length < NUM_ALLOWED_URLS) allowedUrlArrays.push([])
  const dataObj = JSON.parse(att.data)
  const dataHashes: number[][] = []
  const contents: number[][] = []
  for (const rr of att.reponseResolve) {
    const plaintext = String(dataObj[rr.keyName])
    const plaintextBytes = stringToBytes(plaintext)
    contents.push(Array.from(plaintextBytes))
    dataHashes.push(Array.from(sha256(plaintextBytes)))
  }
  const priceValue = dataObj['price']
  const priceConfirmValue = dataObj['price_confirm']
  if (priceValue === undefined || priceConfirmValue === undefined) {
    throw new Error("Attestation data must contain 'price' and 'price_confirm' keys")
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
    priceBytes: Array.from(stringToBytes(String(priceValue))),
    priceConfirmBytes: Array.from(stringToBytes(String(priceConfirmValue))),
    timestamp: BigInt(att.timestamp),
  }
}

export function parseAttestationJson(jsonString: string, allowedUrls?: string[]): ParsedAttestationData {
  const raw = JSON.parse(jsonString)
  return parseAttestation(raw, allowedUrls)
}
