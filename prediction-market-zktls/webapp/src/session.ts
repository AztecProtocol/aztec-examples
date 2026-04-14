/**
 * Session persistence for the prediction market webapp.
 *
 * Stores minimal bootstrap data in localStorage so the app can
 * reconnect to existing accounts and markets on page reload
 * without redeploying anything.
 *
 * Heavy state (notes, nullifiers, contract artifacts) is persisted
 * by the EmbeddedWallet's IndexedDB stores automatically.
 */

const STORAGE_KEY = 'pm-zktls-session'

export interface PersistedAccount {
  name: string
  secret: string // Fr hex string
  salt: string   // Fr hex string
}

export interface PersistedMarket {
  marketAddress: string
  tokenAddress: string
  label: string
  threshold: string      // bigint as string
  thresholdAbove: boolean
  expiry: string         // bigint as string
}

export interface PersistedOrder {
  orderId: string
  cancelSecret: string  // CRITICAL: only way to cancel; lost = locked collateral
  isBuyYes: boolean
  price: string         // bigint as string (PRICE_PRECISION scale)
  amount: string        // bigint as string
  marketAddress: string
}

export interface PersistedSession {
  nodeUrl: string
  walletMode: 'embedded' | 'extension'
  accounts: PersistedAccount[]
  markets: PersistedMarket[]
  orders?: PersistedOrder[]
}

export function saveSession(session: PersistedSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch (e) {
    console.warn('Failed to save session:', e)
  }
}

export function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as PersistedSession
    // Basic validation
    if (!session.nodeUrl || !Array.isArray(session.accounts) || !Array.isArray(session.markets)) {
      return null
    }
    return session
  } catch {
    return null
  }
}

export function updateSessionMarkets(markets: PersistedMarket[]): void {
  const session = loadSession()
  if (!session) return
  session.markets = markets
  saveSession(session)
}

export function updateSessionOrders(orders: PersistedOrder[]): void {
  const session = loadSession()
  if (!session) return
  session.orders = orders
  saveSession(session)
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}
