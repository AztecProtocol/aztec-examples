/**
 * Poseidon2 attester key hash computation.
 * Uses Barretenberg WASM lazily (only when an attestation is provided at deploy time).
 */
import { Fr } from '@aztec/aztec.js/fields'

let bbInstance: import('@aztec/bb.js').Barretenberg | null = null

async function getBb() {
  if (!bbInstance) {
    console.log('Initializing Barretenberg (one-time)...')
    const { Barretenberg } = await import('@aztec/bb.js')
    bbInstance = await Barretenberg.new({ threads: 8 })
  }
  return bbInstance
}

export async function computePoseidon2Hash1(input: Fr): Promise<string> {
  const bb = await getBb()
  const result = await bb.poseidon2Hash({ inputs: [input.toBuffer()] })
  return Fr.fromBuffer(Buffer.from(result.hash)).toString()
}

export async function computeAttesterKeyHash(
  publicKeyX: number[],
  publicKeyY: number[],
): Promise<string> {
  if (publicKeyX.length !== 32 || publicKeyY.length !== 32)
    throw new Error('Public key components must be 32 bytes each')

  const bb = await getBb()

  const inputs: Uint8Array[] = new Array(64).fill(null).map((_, i) => {
    const val = i < 32 ? BigInt(publicKeyX[i]) : BigInt(publicKeyY[i - 32])
    return new Fr(val).toBuffer()
  })

  const result = await bb.poseidon2Hash({ inputs })
  return Fr.fromBuffer(Buffer.from(result.hash)).toString()
}
