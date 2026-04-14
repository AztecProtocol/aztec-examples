/**
 * Extension wallet discovery and connection via @aztec/wallet-sdk.
 * Used when the user wants to connect an external wallet (browser extension).
 */
import { Fr } from '@aztec/aztec.js/fields'
import type { Wallet, AppCapabilities } from '@aztec/aztec.js/wallet'
import { WalletManager, type WalletProvider } from '@aztec/wallet-sdk/manager'
import { hashToEmoji } from '@aztec/wallet-sdk/crypto'

export type { WalletProvider }

const APP_ID = 'prediction-market-zktls'

export function discoverWallets(
  chainId: number,
  onUpdate: (providers: WalletProvider[]) => void,
): { cancel: () => void; done: Promise<void> } {
  const manager = WalletManager.configure({
    extensions: { enabled: true },
  })

  const providers: WalletProvider[] = []

  const discovery = manager.getAvailableWallets({
    chainInfo: {
      chainId: new Fr(chainId),
      version: new Fr(1),
    },
    appId: APP_ID,
    onWalletDiscovered: (provider) => {
      if (providers.some((p) => p.id === provider.id)) return
      providers.push(provider)
      onUpdate([...providers])
    },
  })

  return {
    cancel: () => discovery.cancel(),
    done: discovery.done,
  }
}

export async function connectToProvider(
  provider: WalletProvider,
): Promise<{
  emojis: string
  confirm: () => Promise<Wallet>
  cancel: () => void
}> {
  const pending = await provider.establishSecureChannel(APP_ID)
  const emojis = hashToEmoji(pending.verificationHash)

  return {
    emojis,
    confirm: () => pending.confirm(),
    cancel: () => pending.cancel(),
  }
}

export function getAppCapabilities(): AppCapabilities {
  return {
    version: '1.0',
    metadata: {
      name: 'Prediction Market zkTLS',
      version: '1.0.0',
      description: 'Private prediction market with zkTLS resolution',
      url: window.location.origin,
    },
    capabilities: [
      { type: 'accounts', canGet: true },
      { type: 'contracts', contracts: '*', canRegister: true, canGetMetadata: true },
      { type: 'simulation', transactions: { scope: '*' }, utilities: { scope: '*' } },
      { type: 'transaction', scope: '*' },
    ],
  }
}
