import { createAztecNodeClient } from '@aztec/aztec.js/node'
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee'
import { EmbeddedWallet } from '@aztec/wallets/embedded'
import { NO_FROM } from '@aztec/aztec.js/account'
import { Fr } from '@aztec/aztec.js/fields'
import { AztecAddress } from '@aztec/aztec.js/addresses'
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC'
import {
  type ContractInstanceWithAddress,
  getContractInstanceFromInstantiationParams,
} from '@aztec/aztec.js/contracts'
import type { Wallet } from '@aztec/aztec.js/wallet'
import type { FieldLike } from '@aztec/aztec.js/abi'

import { PredictionMarketZkTLSContract } from '../../artifacts/PredictionMarketZkTLS.js'
import { TokenContract } from '../../artifacts/Token.js'

export type { Wallet, FieldLike }
export { AztecAddress, Fr, PredictionMarketZkTLSContract, TokenContract, EmbeddedWallet }

const SPONSORED_FPC_SALT = new Fr(BigInt(0))

async function getSponsoredFPCInstance(): Promise<ContractInstanceWithAddress> {
  return await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
    salt: SPONSORED_FPC_SALT,
  })
}

export interface AccountCredentials {
  name: string
  secret: Fr
  salt: Fr
}

export interface AztecConnection {
  wallet: EmbeddedWallet
  paymentMethod: SponsoredFeePaymentMethod
  accounts: AztecAddress[]
  accountCredentials: AccountCredentials[]
}

/**
 * Connect to Aztec with an embedded wallet.
 *
 * If `existingAccounts` is provided, reconnects to existing accounts
 * without redeploying them (fast path, ~5s).
 *
 * Otherwise, creates new accounts with fresh random secrets (slow path, ~1min).
 */
export async function connectEmbedded(
  nodeUrl: string,
  existingAccounts?: AccountCredentials[],
): Promise<AztecConnection> {
  console.log(`Connecting to Aztec node at ${nodeUrl}...`)
  const aztecNode = await createAztecNodeClient(nodeUrl)

  const sponsoredFPC = await getSponsoredFPCInstance()
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address)

  // Use persistent storage (IndexedDB) so PXE state survives reloads
  const wallet = await EmbeddedWallet.create(aztecNode)
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact)

  let accountCredentials: AccountCredentials[]

  if (existingAccounts && existingAccounts.length > 0) {
    // Fast path: reconnect to existing accounts (no on-chain deploys)
    console.log('Reconnecting to existing accounts...')
    for (const cred of existingAccounts) {
      await wallet.createSchnorrAccount(cred.secret, cred.salt)
      console.log(`  ${cred.name} reconnected`)
    }
    accountCredentials = existingAccounts
  } else {
    // Slow path: create new accounts (deploys on-chain)
    console.log('Creating accounts (Admin, Alice, Bob)...')
    const names = ['Admin', 'Alice', 'Bob']
    accountCredentials = []
    for (const name of names) {
      const secret = Fr.random()
      const salt = Fr.random()
      const mgr = await wallet.createSchnorrAccount(secret, salt)
      await (await mgr.getDeployMethod()).send({ from: NO_FROM, fee: { paymentMethod } })
      accountCredentials.push({ name, secret, salt })
      console.log(`  ${name} account created`)
    }
  }

  const rawAccounts = await wallet.getAccounts()
  const accounts = rawAccounts.map((a) => a.item)
  console.log(`Admin: ${accounts[0]}`)
  console.log(`Alice: ${accounts[1]}`)
  console.log(`Bob:   ${accounts[2]}`)

  return { wallet, paymentMethod, accounts, accountCredentials }
}

/**
 * Reconnect to an already-deployed market and token contract.
 * PXE should already have the contract instances from a prior session.
 */
export function reconnectToMarket(
  wallet: Wallet,
  marketAddress: AztecAddress,
  tokenAddress: AztecAddress,
): { market: PredictionMarketZkTLSContract; token: TokenContract } {
  return {
    market: PredictionMarketZkTLSContract.at(marketAddress, wallet),
    token: TokenContract.at(tokenAddress, wallet),
  }
}

export function sendOpts(from: AztecAddress, paymentMethod: SponsoredFeePaymentMethod) {
  return { from, fee: { paymentMethod } }
}

export type { SponsoredFeePaymentMethod }
