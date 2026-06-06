/**
 * Browser-based zkTLS attestation generation using @primuslabs/zktls-page-core-sdk.
 *
 * Uses the official SDK pattern from:
 * https://github.com/primus-labs/zktls-demo/tree/main/page-core-sdk-example
 *
 * The WASM files are copied to the build output by vite-plugin-static-copy and
 * loaded via script tags in index.html. The SDK's init/sign/startAttestation
 * methods call the WASM globals internally.
 */

import { PrimusPageCoreTLS } from '@primuslabs/zktls-page-core-sdk'

export interface GenerateResult {
  attestationJson: string
  price: string
}

export const DEFAULT_PRIMUS_APP_ID = '0x7d6a22154952272d267aacc5df6b4f84a154dd97'
export const DEFAULT_PRIMUS_APP_SECRET = '0x600482191cfbdccad360df6edd892a5993a07f1b1542949f32912000b206568c'

// Wait for the WASM Module to be ready (set by primus_zk.js + client_plugin.js via index.html)
async function waitForWasm(timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (!window.Module_callAlgorithm) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        'Primus WASM not ready after ' + (timeoutMs / 1000) + 's. ' +
        'Check browser console for "[Primus WASM]" messages. ' +
        'Try a hard refresh (Ctrl+Shift+R).',
      )
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('Primus WASM ready!')
}

// Declare window globals (set by index.html shim after WASM loads)
declare global {
  interface Window {
    Module_callAlgorithm: ((params: string) => string) | null | undefined
  }
}

export type TlsMode = 'proxytls' | 'mpctls'

export interface GenerateOptions {
  appId?: string
  appSecret?: string
  coinGeckoApiKey?: string
  tlsMode?: TlsMode
}

export async function generateAttestation(opts: GenerateOptions = {}): Promise<GenerateResult> {
  const appId = opts.appId?.trim() || DEFAULT_PRIMUS_APP_ID
  const appSecret = opts.appSecret?.trim() || DEFAULT_PRIMUS_APP_SECRET

  console.log('Waiting for Primus WASM...')
  await waitForWasm()

  console.log('Initializing Primus zkTLS...')
  const zkTLS = new PrimusPageCoreTLS()
  await zkTLS.init(appId, appSecret)

  // Build URL with optional CoinGecko API key to avoid rate limits
  let url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
  if (opts.coinGeckoApiKey?.trim()) {
    url += `&x_cg_demo_api_key=${opts.coinGeckoApiKey.trim()}`
    console.log('Using CoinGecko API key to avoid rate limits')
  }

  const request = {
    url,
    method: 'GET',
    header: JSON.stringify({ Accept: 'application/json', 'User-Agent': 'PrimusZKTLS/1.0' }),
    body: '',
  }

  const responseResolves = [
    { keyName: 'price', parsePath: '$.bitcoin.usd' },
    { keyName: 'price_confirm', parsePath: '$.bitcoin.usd' },
  ]

  console.log('Building attestation request...')
  const attRequest = zkTLS.generateRequestParams(request, responseResolves)
  const mode = opts.tlsMode || 'proxytls'
  attRequest.setAttMode({ algorithmType: mode })
  console.log(`Using ${mode} mode${mode === 'proxytls' ? ' (faster, trusts attester for TLS)' : ' (slower, stronger security)'}`)

  console.log('Signing request...')
  const requestStr = attRequest.toJsonString()
  const signedStr = await zkTLS.sign(requestStr)

  console.log('Starting MPC-TLS attestation (fetching BTC price from CoinGecko)...')
  const attestation = await zkTLS.startAttestation(signedStr)

  console.log('Verifying attestation locally...')
  const valid = zkTLS.verifyAttestation(attestation)
  if (!valid) {
    throw new Error('Attestation verification failed')
  }

  const dataObj = JSON.parse(attestation.data)
  const price = String(dataObj['price'] ?? dataObj['price_confirm'] ?? 'unknown')

  console.log(`Attestation verified! BTC/USD price: $${price}`)

  return {
    attestationJson: JSON.stringify(attestation, null, 2),
    price,
  }
}
