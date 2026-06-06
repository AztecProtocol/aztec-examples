import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'
import { setLogCallback } from './consoleInterceptor'
import {
  connectEmbedded,
  reconnectToMarket,
  sendOpts,
  AztecAddress,
  Fr,
  PredictionMarketZkTLSContract,
  TokenContract,
  type Wallet,
  type FieldLike,
  type SponsoredFeePaymentMethod,
  type AztecConnection,
} from './aztec'
import { parseAttestationJson, DEFAULT_ALLOWED_URLS } from './attestation'
import { computeAttesterKeyHash, computePoseidon2Hash1 } from './url-hashes'
import {
  loadSession,
  saveSession,
  updateSessionMarkets,
  updateSessionOrders,
  clearSession,
  type PersistedMarket,
  type PersistedOrder,
} from './session'
import {
  discoverWallets,
  connectToProvider,
  getAppCapabilities,
  type WalletProvider,
} from './wallet-connection'
import type { GrantedAccountsCapability } from '@aztec/aztec.js/wallet'
import { generateAttestation, DEFAULT_PRIMUS_APP_ID, DEFAULT_PRIMUS_APP_SECRET } from './generate-attestation'

// --- Types ---

type Phase = 'connect' | 'markets' | 'trade' | 'resolve' | 'create'

interface MarketInfo {
  id: string
  label: string
  market: PredictionMarketZkTLSContract
  token: TokenContract
  expiry: bigint
  threshold: bigint
  thresholdAbove: boolean
  totalSets: bigint
  isResolved: boolean
  outcome: boolean | null
  resolvedPrice: bigint | null
}

// --- Component ---

export default function App() {
  // Connection
  const [phase, setPhase] = useState<Phase>('connect')
  const [conn, setConn] = useState<AztecConnection | null>(null)
  const [walletMode, setWalletMode] = useState<'embedded' | 'extension'>('embedded')
  const [nodeUrl, setNodeUrl] = useState('http://localhost:8080')

  // Extension wallet
  const [extProviders, setExtProviders] = useState<WalletProvider[]>([])
  const [extEmojis, setExtEmojis] = useState<string | null>(null)
  const [extWallet, setExtWallet] = useState<Wallet | null>(null)
  const [extAccount, setExtAccount] = useState<AztecAddress | null>(null)

  // Markets list
  const [markets, setMarkets] = useState<MarketInfo[]>([])
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null)
  const [joinAddress, setJoinAddress] = useState('')

  // Create market form
  const [threshold, setThreshold] = useState('50000')
  const [thresholdAbove, setThresholdAbove] = useState(true)
  const [expiryMinutes, setExpiryMinutes] = useState('5')
  const [attestationJson, setAttestationJson] = useState('')

  // Trading
  const [depositAmount, setDepositAmount] = useState('1000')
  const [redeemAmount, setRedeemAmount] = useState('1000')
  const [activeTrader, setActiveTrader] = useState<'alice' | 'bob'>('alice')

  // Attestation generation
  const [primusAppId, setPrimusAppId] = useState(DEFAULT_PRIMUS_APP_ID)
  const [primusAppSecret, setPrimusAppSecret] = useState(DEFAULT_PRIMUS_APP_SECRET)
  const [coinGeckoApiKey, setCoinGeckoApiKey] = useState('')
  const [tlsMode, setTlsMode] = useState<'proxytls' | 'mpctls'>('proxytls')

  // CLOB order book state
  interface OrderInfo {
    orderId: string
    isBuyYes: boolean
    price: bigint
    amount: bigint
    isConsumed: boolean
    cancelSecret?: string  // only for own orders
  }
  const [orders, setOrders] = useState<OrderInfo[]>([])
  const [orderPrice, setOrderPrice] = useState('0.50')
  const [orderAmount, setOrderAmount] = useState('100')
  const [orderSide, setOrderSide] = useState<'yes' | 'no'>('yes')
  const PRICE_PRECISION = 1_000_000n

  // Balances for selected market
  const [balances, setBalances] = useState<Record<string, { yes: bigint; no: bigint; tokens: bigint }>>({})

  // UI
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const withLogs = useCallback(async (fn: () => Promise<void>) => {
    setLoading(true)
    setLogCallback((prefix, message) => {
      setLogs((prev) => [...prev, `${prefix} ${message}`])
    })
    try {
      await fn()
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null
          ? JSON.stringify(err, null, 2)
          : String(err)
      console.error(msg)
    } finally {
      setLogCallback(null)
      setLoading(false)
    }
  }, [])

  // --- Session persistence helpers ---

  function persistMarkets(marketList: MarketInfo[]) {
    const persisted: PersistedMarket[] = marketList.map((m) => ({
      marketAddress: m.id,
      tokenAddress: m.token.address.toString(),
      label: m.label,
      threshold: m.threshold.toString(),
      thresholdAbove: m.thresholdAbove,
      expiry: m.expiry.toString(),
    }))
    updateSessionMarkets(persisted)
  }

  // Auto-reconnect on mount
  useEffect(() => {
    const session = loadSession()
    if (!session || session.walletMode !== 'embedded' || session.accounts.length === 0) return

    withLogs(async () => {
      console.log('Restoring session...')
      const credentials = session.accounts.map((a) => ({
        name: a.name,
        secret: Fr.fromString(a.secret),
        salt: Fr.fromString(a.salt),
      }))

      try {
        const connection = await connectEmbedded(session.nodeUrl, credentials)
        setConn(connection)
        setNodeUrl(session.nodeUrl)

        // Reconnect to known markets
        const restoredMarkets: MarketInfo[] = []
        for (const pm of session.markets) {
          try {
            const marketAddr = AztecAddress.fromString(pm.marketAddress)
            const tokenAddr = AztecAddress.fromString(pm.tokenAddress)
            const { market, token } = reconnectToMarket(
              connection.wallet as unknown as Wallet,
              marketAddr,
              tokenAddr,
            )

            const admin = connection.accounts[0]
            const { result: totalSets } = await market.methods.get_total_sets().simulate({ from: admin })
            const { result: resolved } = await market.methods.is_resolved().simulate({ from: admin })
            let outcome: boolean | null = null
            let resolvedPrice: bigint | null = null
            if (resolved) {
              const { result: o } = await market.methods.get_resolution_outcome().simulate({ from: admin })
              const { result: p } = await market.methods.get_resolution_price().simulate({ from: admin })
              outcome = o
              resolvedPrice = p
            }

            restoredMarkets.push({
              id: pm.marketAddress,
              label: pm.label,
              market,
              token,
              expiry: BigInt(pm.expiry),
              threshold: BigInt(pm.threshold),
              thresholdAbove: pm.thresholdAbove,
              totalSets,
              isResolved: resolved,
              outcome,
              resolvedPrice,
            })
            console.log(`  Restored market: ${pm.label}`)
          } catch (e) {
            console.warn(`  Failed to restore market ${pm.label}: ${e}`)
          }
        }

        setMarkets(restoredMarkets)
        setPhase('markets')
        console.log(`Session restored! ${restoredMarkets.length} market(s) loaded.`)
      } catch (e) {
        console.error(`Session restore failed: ${e}`)
        console.log('Starting fresh...')
        clearSession()
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reset and auto-refresh per-market state when switching markets
  const selectedMarketIdRef = useRef(selectedMarketId)
  selectedMarketIdRef.current = selectedMarketId
  useEffect(() => {
    if (!selectedMarketId || !conn) return
    const mkt = markets.find((m) => m.id === selectedMarketId)
    if (!mkt) return

    // Clear stale data immediately
    setBalances({})
    setOrders([])

    // Fetch fresh data for the newly selected market
    const admin = walletMode === 'extension' ? extAccount : conn.accounts[0]
    if (!admin) return

    ;(async () => {
      try {
        const { market, token } = mkt
        const results: Record<string, { yes: bigint; no: bigint; tokens: bigint }> = {}

        if (walletMode === 'embedded') {
          for (const [name, addr] of [
            ['alice', conn.accounts[1]],
            ['bob', conn.accounts[2]],
          ] as const) {
            const { result: yes } = await market.methods.get_yes_balance(addr).simulate({ from: addr })
            const { result: no } = await market.methods.get_no_balance(addr).simulate({ from: addr })
            const { result: tokens } = await token.methods.balance_of_private(addr).simulate({ from: addr })
            results[name] = { yes, no, tokens }
          }
        } else if (extAccount) {
          const { result: yes } = await market.methods.get_yes_balance(extAccount).simulate({ from: extAccount })
          const { result: no } = await market.methods.get_no_balance(extAccount).simulate({ from: extAccount })
          const { result: tokens } = await token.methods.balance_of_private(extAccount).simulate({ from: extAccount })
          results['you'] = { yes, no, tokens }
        }

        if (selectedMarketIdRef.current !== selectedMarketId) return
        setBalances(results)

        // Load persisted orders for this market
        await refreshOrders(mkt)
      } catch (e) {
        console.warn('Auto-refresh failed:', e)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMarketId])

  // --- Helpers ---

  function getWallet(): Wallet {
    if (walletMode === 'extension' && extWallet) return extWallet
    if (conn) return conn.wallet as unknown as Wallet
    throw new Error('No wallet connected')
  }

  function getPaymentMethod(): SponsoredFeePaymentMethod {
    if (!conn) throw new Error('Not connected')
    return conn.paymentMethod
  }

  function getTraderAddress(): AztecAddress {
    if (walletMode === 'extension') {
      if (!extAccount) throw new Error('No extension account')
      return extAccount
    }
    if (!conn) throw new Error('Not connected')
    return activeTrader === 'alice' ? conn.accounts[1] : conn.accounts[2]
  }

  function getAdminAddress(): AztecAddress {
    if (walletMode === 'extension') {
      if (!extAccount) throw new Error('No extension account')
      return extAccount
    }
    if (!conn) throw new Error('Not connected')
    return conn.accounts[0]
  }

  function getSelectedMarket(): MarketInfo | undefined {
    return markets.find((m) => m.id === selectedMarketId)
  }

  // --- Connect ---

  async function handleConnectEmbedded() {
    await withLogs(async () => {
      const connection = await connectEmbedded(nodeUrl)
      setConn(connection)

      // Persist session for fast reconnect on reload
      saveSession({
        nodeUrl,
        walletMode: 'embedded',
        accounts: connection.accountCredentials.map((a) => ({
          name: a.name,
          secret: a.secret.toString(),
          salt: a.salt.toString(),
        })),
        markets: [],
      })

      setPhase('markets')
      console.log('Connected with embedded wallet!')
    })
  }

  async function handleDiscoverExtensions() {
    setExtProviders([])
    const { done } = discoverWallets(31337, (found) => {
      setExtProviders(found)
    })
    await done
  }

  async function handleConnectExtension(provider: WalletProvider) {
    await withLogs(async () => {
      console.log(`Connecting to ${provider.name}...`)
      const { emojis, confirm } = await connectToProvider(provider)
      setExtEmojis(emojis)
      console.log('Verify emojis in wallet extension, then approve.')

      const wallet = await confirm()
      setExtEmojis(null)

      console.log('Requesting capabilities...')
      const manifest = getAppCapabilities()
      const capabilities = await wallet.requestCapabilities(manifest)

      const accountsCap = capabilities.granted.find(
        (c): c is GrantedAccountsCapability => c.type === 'accounts',
      )

      if (!accountsCap?.accounts?.length) {
        throw new Error('No accounts granted by wallet extension')
      }

      const addr = accountsCap.accounts[0]
      setExtWallet(wallet)
      setExtAccount(AztecAddress.fromString(addr.toString()))
      console.log(`Connected to extension wallet. Account: ${addr}`)
      setPhase('markets')
    })
  }

  // --- Refresh single market info ---

  async function refreshMarketInfo(info: MarketInfo): Promise<MarketInfo> {
    const admin = getAdminAddress()
    const { result: totalSets } = await info.market.methods.get_total_sets().simulate({ from: admin })
    const { result: resolved } = await info.market.methods.is_resolved().simulate({ from: admin })
    let outcome: boolean | null = null
    let resolvedPrice: bigint | null = null
    if (resolved) {
      const { result: o } = await info.market.methods.get_resolution_outcome().simulate({ from: admin })
      const { result: p } = await info.market.methods.get_resolution_price().simulate({ from: admin })
      outcome = o
      resolvedPrice = p
    }
    return { ...info, totalSets, isResolved: resolved, outcome, resolvedPrice }
  }

  // --- Refresh all markets ---

  async function refreshAllMarkets() {
    const updated: MarketInfo[] = []
    for (const m of markets) {
      updated.push(await refreshMarketInfo(m))
    }
    setMarkets(updated)
  }

  // --- Create Market ---

  async function handleCreateMarket() {
    await withLogs(async () => {
      const wallet = getWallet()
      const admin = getAdminAddress()
      const pm = getPaymentMethod()

      const thresholdCents = BigInt(Math.round(parseFloat(threshold) * 100))
      const expiry = BigInt(Math.floor(Date.now() / 1000) + parseInt(expiryMinutes) * 60)

      // Default Primus attester key hash (Poseidon2 of the attester's secp256k1 public key).
      // This is the same attester for all Primus MPC-TLS attestations.
      const DEFAULT_ATTESTER_KEY_HASH = '0x235a6724db33a90484cb0a30b155249e861b08c9b4c27387ee76fb3df8b26e5e'

      let attesterKeyHash: string
      if (attestationJson.trim()) {
        console.log('Computing attester key hash from attestation...')
        const parsed = parseAttestationJson(attestationJson)
        attesterKeyHash = await computeAttesterKeyHash(parsed.publicKeyX, parsed.publicKeyY)
      } else {
        attesterKeyHash = DEFAULT_ATTESTER_KEY_HASH
        console.log('Using default Primus attester key hash')
      }

      // Pre-computed Poseidon2 hash of "https://api.coingecko.com" (all 3 slots identical)
      const COINGECKO_URL_HASH = '0x036770b1560e1a8437e9c3607a410995ed8954d6c7b901cc621b5599ff5983c4'
      const urlHashes = [COINGECKO_URL_HASH, COINGECKO_URL_HASH, COINGECKO_URL_HASH]

      console.log(`Deploying market (threshold=$${threshold}, expiry in ${expiryMinutes}min)...`)
      const { contract: market } = await PredictionMarketZkTLSContract.deploy(
        wallet, admin, expiry, thresholdCents, thresholdAbove,
        urlHashes as unknown as FieldLike[],
        attesterKeyHash as unknown as FieldLike,
      ).send(sendOpts(admin, pm))
      console.log(`Market deployed: ${market.address}`)

      console.log('Deploying collateral token...')
      const { contract: token } = await TokenContract.deployWithOpts<'constructor_with_minter'>(
        { method: 'constructor_with_minter', wallet },
        'Prediction Collateral', 'PCOL', 18, admin,
      ).send(sendOpts(admin, pm))
      console.log(`Token deployed: ${token.address}`)

      await market.methods.set_token(token.address).send(sendOpts(admin, pm))
      console.log('Linked market -> token')

      if (walletMode === 'embedded' && conn) {
        const [, alice, bob] = conn.accounts
        await token.methods.mint_to_private(alice, 10000n).send(sendOpts(admin, pm))
        await token.methods.mint_to_private(bob, 10000n).send(sendOpts(admin, pm))
        console.log('Minted 10,000 collateral tokens each to Alice and Bob')
      }

      const aboveStr = thresholdAbove ? '>=' : '<'
      const label = `BTC ${aboveStr} $${Number(thresholdCents / 100n).toLocaleString()}`
      const newMarket: MarketInfo = {
        id: market.address.toString(),
        label,
        market, token, expiry,
        threshold: thresholdCents,
        thresholdAbove,
        totalSets: 0n,
        isResolved: false,
        outcome: null,
        resolvedPrice: null,
      }

      setMarkets((prev) => {
        const updated = [...prev, newMarket]
        persistMarkets(updated)
        return updated
      })
      setSelectedMarketId(newMarket.id)
      setPhase('markets')
      console.log('Market created!')
    })
  }

  // --- Join existing market by address ---

  async function handleJoinMarket() {
    await withLogs(async () => {
      if (!joinAddress.trim()) throw new Error('Enter a market contract address')
      const wallet = getWallet()
      const admin = getAdminAddress()

      console.log(`Connecting to market at ${joinAddress}...`)
      const market = await PredictionMarketZkTLSContract.at(
        AztecAddress.fromString(joinAddress.trim()), wallet,
      )

      const { result: tokenAddr } = await market.methods.get_token().simulate({ from: admin })
      console.log(`Token: ${tokenAddr}`)
      const token = await TokenContract.at(tokenAddr, wallet)

      const { result: expiry } = await market.methods.get_expiry().simulate({ from: admin })
      const { result: thresh } = await market.methods.get_price_threshold().simulate({ from: admin })
      const { result: above } = await market.methods.get_threshold_above().simulate({ from: admin })
      const { result: totalSets } = await market.methods.get_total_sets().simulate({ from: admin })
      const { result: resolved } = await market.methods.is_resolved().simulate({ from: admin })

      let outcome: boolean | null = null
      let resolvedPrice: bigint | null = null
      if (resolved) {
        const { result: o } = await market.methods.get_resolution_outcome().simulate({ from: admin })
        const { result: p } = await market.methods.get_resolution_price().simulate({ from: admin })
        outcome = o
        resolvedPrice = p
      }

      const aboveStr = above ? '>=' : '<'
      const label = `BTC ${aboveStr} $${Number(thresh / 100n).toLocaleString()}`

      const info: MarketInfo = {
        id: market.address.toString(),
        label, market, token,
        expiry: BigInt(expiry),
        threshold: thresh,
        thresholdAbove: above,
        totalSets, isResolved: resolved, outcome, resolvedPrice,
      }

      setMarkets((prev) => {
        if (prev.some((m) => m.id === info.id)) return prev
        const updated = [...prev, info]
        persistMarkets(updated)
        return updated
      })
      setSelectedMarketId(info.id)
      setJoinAddress('')
      console.log(`Joined market: ${label}`)
    })
  }

  // --- Refresh balances for selected market ---

  async function refreshBalances() {
    const mkt = getSelectedMarket()
    if (!mkt || !conn) return
    const { market, token } = mkt

    const results: Record<string, { yes: bigint; no: bigint; tokens: bigint }> = {}

    if (walletMode === 'embedded') {
      for (const [name, addr] of [
        ['alice', conn.accounts[1]],
        ['bob', conn.accounts[2]],
      ] as const) {
        const { result: yes } = await market.methods.get_yes_balance(addr).simulate({ from: addr })
        const { result: no } = await market.methods.get_no_balance(addr).simulate({ from: addr })
        const { result: tokens } = await token.methods.balance_of_private(addr).simulate({ from: addr })
        results[name] = { yes, no, tokens }
      }
    } else if (extAccount) {
      const { result: yes } = await market.methods.get_yes_balance(extAccount).simulate({ from: extAccount })
      const { result: no } = await market.methods.get_no_balance(extAccount).simulate({ from: extAccount })
      const { result: tokens } = await token.methods.balance_of_private(extAccount).simulate({ from: extAccount })
      results['you'] = { yes, no, tokens }
    }

    const updated = await refreshMarketInfo(mkt)
    setMarkets((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
    setBalances(results)
  }

  // --- Refresh order book ---

  async function refreshOrders(mkt?: MarketInfo) {
    const market = mkt ?? getSelectedMarket()
    if (!market || !conn) return
    const admin = getAdminAddress()

    // Load persisted order IDs for this market
    const session = loadSession()
    const persisted = (session?.orders ?? []).filter((o) => o.marketAddress === market.id)

    const refreshed: OrderInfo[] = []
    for (const po of persisted) {
      try {
        const { result: [order, isConsumed] } = await market.market.methods
          .get_order(po.orderId as unknown as FieldLike)
          .simulate({ from: admin })
        refreshed.push({
          orderId: po.orderId,
          isBuyYes: order.is_buy_yes,
          price: order.price,
          amount: order.amount,
          isConsumed,
          cancelSecret: po.cancelSecret,
        })
      } catch {
        // Order not found or error -- skip
      }
    }
    setOrders(refreshed)
  }

  function persistOrder(orderId: string, cancelSecret: string, isBuyYes: boolean, price: bigint, amount: bigint, marketAddress: string) {
    const session = loadSession()
    if (!session) return
    const existing = session.orders ?? []
    const po: PersistedOrder = {
      orderId,
      cancelSecret,
      isBuyYes,
      price: price.toString(),
      amount: amount.toString(),
      marketAddress,
    }
    updateSessionOrders([...existing, po])
  }

  function removePersistedOrder(orderId: string) {
    const session = loadSession()
    if (!session) return
    updateSessionOrders((session.orders ?? []).filter((o) => o.orderId !== orderId))
  }

  // --- Trade actions ---

  async function handleDeposit() {
    await withLogs(async () => {
      const mkt = getSelectedMarket()
      if (!mkt || !conn) return
      const { market, token } = mkt
      const wallet = getWallet()
      const pm = getPaymentMethod()
      const trader = getTraderAddress()
      const amount = BigInt(depositAmount)

      const nonce = Fr.random()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const witness = await (wallet as any).createAuthWit(trader, {
        caller: market.address,
        action: token.methods.transfer_private_to_public(trader, market.address, amount, nonce),
      })

      console.log(`Depositing ${amount} tokens to get YES + NO shares...`)
      await market.methods
        .mint_sets(amount, nonce)
        .send({ ...sendOpts(trader, pm), authWitnesses: [witness] })
      console.log('Deposit complete! You now hold equal YES and NO shares.')
      await refreshBalances()
    })
  }

  async function handleWithdraw() {
    await withLogs(async () => {
      const mkt = getSelectedMarket()
      if (!mkt || !conn) return
      const { market } = mkt
      const pm = getPaymentMethod()
      const trader = getTraderAddress()
      const amount = BigInt(depositAmount)

      console.log(`Withdrawing ${amount} (returning equal YES + NO shares for collateral)...`)
      await market.methods.burn_sets(amount).send(sendOpts(trader, pm))
      console.log('Withdrawal complete! Collateral returned.')
      await refreshBalances()
    })
  }

  async function handleRedeem() {
    await withLogs(async () => {
      const mkt = getSelectedMarket()
      if (!mkt || !conn) return
      const { market } = mkt
      const pm = getPaymentMethod()
      const trader = getTraderAddress()
      const amount = BigInt(redeemAmount)

      console.log(`Claiming ${amount} winning shares for collateral...`)
      await market.methods.redeem(amount).send(sendOpts(trader, pm))
      console.log('Payout complete!')
      await refreshBalances()
    })
  }

  async function handlePlaceOrder() {
    await withLogs(async () => {
      const mkt = getSelectedMarket()
      if (!mkt || !conn) return
      const { market, token } = mkt
      const wallet = getWallet()
      const pm = getPaymentMethod()
      const trader = getTraderAddress()

      const isBuyYes = orderSide === 'yes'
      const price = BigInt(Math.round(parseFloat(orderPrice) * 1_000_000))
      const amount = BigInt(orderAmount)
      const cancelSecret = Fr.random()
      const collateral = (amount * price) / PRICE_PRECISION

      const nonce = Fr.random()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const witness = await (wallet as any).createAuthWit(trader, {
        caller: market.address,
        action: token.methods.transfer_private_to_public(trader, market.address, collateral, nonce),
      })

      // Compute orderId = Poseidon2(cancelSecret) client-side (deterministic)
      const orderId = await computePoseidon2Hash1(cancelSecret)

      console.log(`Placing ${isBuyYes ? 'YES' : 'NO'} order: ${amount} shares @ $${orderPrice} (${collateral} collateral)...`)
      await market.methods
        .place_order(isBuyYes, price, amount, cancelSecret, nonce)
        .send({ ...sendOpts(trader, pm), authWitnesses: [witness] })
      console.log(`Order placed! ID: ${orderId}`)

      persistOrder(orderId, cancelSecret.toString(), isBuyYes, price, amount, mkt.id)
      await refreshOrders()
      await refreshBalances()
    })
  }

  async function handleTakeOrder(orderId: string) {
    await withLogs(async () => {
      const mkt = getSelectedMarket()
      if (!mkt || !conn) return
      const { market, token } = mkt
      const wallet = getWallet()
      const pm = getPaymentMethod()
      const trader = getTraderAddress()

      const order = orders.find((o) => o.orderId === orderId)
      if (!order) throw new Error('Order not found')

      const takerCollateral = (order.amount * (PRICE_PRECISION - order.price)) / PRICE_PRECISION

      const nonce = Fr.random()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const witness = await (wallet as any).createAuthWit(trader, {
        caller: market.address,
        action: token.methods.transfer_private_to_public(trader, market.address, takerCollateral, nonce),
      })

      const takerSide = order.isBuyYes ? 'NO' : 'YES'
      console.log(`Taking order ${orderId.slice(0, 10)}... (you get ${takerSide} shares, cost: ${takerCollateral})`)
      await market.methods
        .take_order(orderId as unknown as FieldLike, nonce)
        .send({ ...sendOpts(trader, pm), authWitnesses: [witness] })
      console.log('Order filled!')
      await refreshOrders()
      await refreshBalances()
    })
  }

  async function handleCancelOrder(orderId: string, cancelSecret: string) {
    await withLogs(async () => {
      const mkt = getSelectedMarket()
      if (!mkt || !conn) return
      const { market } = mkt
      const pm = getPaymentMethod()
      const trader = getTraderAddress()

      console.log(`Cancelling order ${orderId.slice(0, 10)}...`)
      await market.methods
        .cancel_order(orderId as unknown as FieldLike, cancelSecret as unknown as FieldLike)
        .send(sendOpts(trader, pm))
      console.log('Order cancelled! Collateral refunded.')
      removePersistedOrder(orderId)
      await refreshOrders()
      await refreshBalances()
    })
  }

  async function handleGenerateAttestation() {
    await withLogs(async () => {
      if (!primusAppId.trim()) throw new Error('Enter a Primus App ID')

      const result = await generateAttestation({
        appId: primusAppId,
        appSecret: primusAppSecret,
        coinGeckoApiKey,
        tlsMode,
      })
      setAttestationJson(result.attestationJson)
      console.log(`Attestation generated! BTC price: $${result.price}`)
    })
  }

  async function handleResolve() {
    await withLogs(async () => {
      const mkt = getSelectedMarket()
      if (!mkt || !conn) return
      if (!attestationJson.trim()) throw new Error('Paste attestation JSON first')
      const { market } = mkt
      const pm = getPaymentMethod()
      const admin = getAdminAddress()

      console.log('Parsing attestation...')
      const parsed = parseAttestationJson(attestationJson)

      console.log('Resolving market with zkTLS price attestation...')
      await market.methods
        .resolve_market(
          parsed.publicKeyX, parsed.publicKeyY,
          parsed.hash, parsed.signature,
          parsed.requestUrls, parsed.allowedUrls,
          parsed.dataHashes, parsed.contents,
          parsed.timestamp,
        )
        .send(sendOpts(admin, pm))

      console.log('Market resolved!')
      await refreshBalances()
      setPhase('trade')
    })
  }

  // --- Disconnect ---

  function handleDisconnect() {
    clearSession()
    setConn(null)
    setMarkets([])
    setSelectedMarketId(null)
    setBalances({})
    setPhase('connect')
    setLogs([])
    console.log('Session cleared. Reload for a fresh start.')
  }

  // --- Derived state ---

  const selectedMarket = getSelectedMarket()
  const now = Math.floor(Date.now() / 1000)

  // --- Render ---

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <div>
            <h1>Prediction Market <span className="accent">zkTLS</span></h1>
            <p className="subtitle">Private binary prediction markets with Primus price attestations on Aztec</p>
          </div>
          {conn && (
            <button className="btn small disconnect-btn" onClick={handleDisconnect}>
              Disconnect
            </button>
          )}
        </div>
      </header>

      <div className="layout">
        <div className="panel main-panel">

          {/* ===== CONNECT ===== */}
          {phase === 'connect' && (
            <section className="section">
              <h2>Connect Wallet</h2>
              <div className="tabs">
                <button className={`tab ${walletMode === 'embedded' ? 'active' : ''}`}
                  onClick={() => setWalletMode('embedded')}>Embedded Wallet</button>
                <button className={`tab ${walletMode === 'extension' ? 'active' : ''}`}
                  onClick={() => { setWalletMode('extension'); handleDiscoverExtensions() }}>Extension Wallet</button>
              </div>

              {walletMode === 'embedded' && (
                <div className="form-group">
                  <label>Node URL</label>
                  <input type="text" value={nodeUrl} onChange={(e) => setNodeUrl(e.target.value)} disabled={loading} />
                  <p className="hint">Creates 3 ephemeral accounts: Admin, Alice, Bob</p>
                  <button className="btn primary" onClick={handleConnectEmbedded} disabled={loading}>
                    {loading ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              )}

              {walletMode === 'extension' && (
                <div className="form-group">
                  {extEmojis && (
                    <div className="emoji-verify">
                      <p>Verify these emojis match your wallet extension:</p>
                      <div className="emojis">{extEmojis}</div>
                    </div>
                  )}
                  {!extEmojis && extProviders.length === 0 && <p className="hint">Looking for wallet extensions...</p>}
                  {!extEmojis && extProviders.map((p, i) => (
                    <button key={i} className="btn provider-btn" onClick={() => handleConnectExtension(p)} disabled={loading}>
                      {p.icon && <img src={p.icon} alt="" className="provider-icon" />}
                      Connect to {p.name}
                    </button>
                  ))}
                  {!extEmojis && extProviders.length === 0 && (
                    <button className="btn" onClick={handleDiscoverExtensions} disabled={loading}>Refresh</button>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ===== MARKETS LIST ===== */}
          {phase === 'markets' && (
            <section className="section">
              <div className="section-header">
                <h2>Markets</h2>
                <button className="btn primary" onClick={() => setPhase('create')} disabled={loading}>
                  + Create Market
                </button>
              </div>

              {/* Join existing market */}
              <div className="join-market">
                <div className="join-row">
                  <input
                    type="text"
                    value={joinAddress}
                    onChange={(e) => setJoinAddress(e.target.value)}
                    placeholder="Paste a market contract address to join..."
                    disabled={loading}
                  />
                  <button className="btn" onClick={handleJoinMarket} disabled={loading || !joinAddress.trim()}>
                    Join
                  </button>
                </div>
              </div>

              {/* Market cards */}
              {markets.length === 0 ? (
                <div className="empty-state">
                  <p>No markets yet. Create one or join an existing market by address.</p>
                </div>
              ) : (
                <div className="market-cards">
                  {markets.map((m) => (
                    <div
                      key={m.id}
                      className={`market-card ${selectedMarketId === m.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedMarketId(m.id)
                        setPhase('trade')
                      }}
                    >
                      <div className="market-card-header">
                        <h3>{m.label}</h3>
                        <span className={`status-badge ${m.isResolved ? 'resolved' : now > Number(m.expiry) ? 'expired' : 'active'}`}>
                          {m.isResolved
                            ? `${m.outcome ? 'YES' : 'NO'} wins`
                            : now > Number(m.expiry)
                              ? 'Awaiting resolution'
                              : 'Active'}
                        </span>
                      </div>
                      <div className="market-card-details">
                        <div className="detail">
                          <span className="detail-label">Expiry</span>
                          <span>{new Date(Number(m.expiry) * 1000).toLocaleString()}</span>
                        </div>
                        <div className="detail">
                          <span className="detail-label">Total deposited</span>
                          <span>{m.totalSets.toString()} sets</span>
                        </div>
                        {m.isResolved && m.resolvedPrice != null && (
                          <div className="detail">
                            <span className="detail-label">Settled price</span>
                            <span>${(Number(m.resolvedPrice) / 100).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                      <div className="market-card-address">
                        {m.id.slice(0, 10)}...{m.id.slice(-8)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="button-row" style={{ marginTop: '1rem' }}>
                <button className="btn small" onClick={() => withLogs(refreshAllMarkets)} disabled={loading}>
                  Refresh All
                </button>
              </div>
            </section>
          )}

          {/* ===== CREATE MARKET ===== */}
          {phase === 'create' && (
            <section className="section">
              <h2>Create New Market</h2>
              <p className="hint" style={{ marginBottom: '1rem' }}>
                Deploy a new prediction market. You choose the question (price threshold and direction) and when it expires.
              </p>
              <div className="form-group">
                <label>Price Threshold ($)</label>
                <input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={loading} />
                <p className="hint">e.g. 50000 means "Will BTC be above/below $50,000?"</p>
              </div>
              <div className="form-group">
                <label>Direction</label>
                <select value={thresholdAbove ? 'above' : 'below'}
                  onChange={(e) => setThresholdAbove(e.target.value === 'above')} disabled={loading}>
                  <option value="above">YES wins if price &gt;= threshold</option>
                  <option value="below">YES wins if price &lt; threshold</option>
                </select>
              </div>
              <div className="form-group">
                <label>Expiry (minutes from now)</label>
                <input type="number" value={expiryMinutes} onChange={(e) => setExpiryMinutes(e.target.value)} disabled={loading} />
              </div>
              <div className="form-group">
                <label>Attestation JSON (optional)</label>
                <textarea rows={4} value={attestationJson} onChange={(e) => setAttestationJson(e.target.value)}
                  placeholder="Paste attestation.json to pin the attester key at deployment..." disabled={loading} />
                <p className="hint">Required for resolution. You can also add it later.</p>
              </div>
              <div className="button-row">
                <button className="btn primary" onClick={handleCreateMarket} disabled={loading}>
                  {loading ? 'Deploying...' : 'Create Market'}
                </button>
                <button className="btn" onClick={() => setPhase('markets')} disabled={loading}>Cancel</button>
              </div>
            </section>
          )}

          {/* ===== TRADE ===== */}
          {phase === 'trade' && selectedMarket && (
            <section className="section">
              <div className="section-header">
                <h2>{selectedMarket.label}</h2>
                <button className="btn small" onClick={() => setPhase('markets')}>All Markets</button>
              </div>

              {/* Market status card */}
              <div className="market-info">
                <div className="info-row">
                  <span>Total sets minted</span>
                  <strong>{selectedMarket.totalSets.toString()}</strong>
                </div>
                <div className="info-row">
                  <span>Expiry</span>
                  <strong>{new Date(Number(selectedMarket.expiry) * 1000).toLocaleString()}</strong>
                </div>
                <div className="info-row">
                  <span>Status</span>
                  <strong className={selectedMarket.isResolved ? 'resolved' : 'active'}>
                    {selectedMarket.isResolved
                      ? `Settled: ${selectedMarket.outcome ? 'YES' : 'NO'} wins ($${selectedMarket.resolvedPrice ? (Number(selectedMarket.resolvedPrice) / 100).toLocaleString() : '?'})`
                      : now > Number(selectedMarket.expiry)
                        ? 'Expired -- awaiting resolution'
                        : 'Trading'}
                  </strong>
                </div>
                <div className="info-row">
                  <span>Contract</span>
                  <strong className="mono">{selectedMarket.id.slice(0, 14)}...{selectedMarket.id.slice(-8)}</strong>
                </div>
              </div>

              {/* Trader selector (embedded mode) */}
              {walletMode === 'embedded' && (
                <div className="form-group">
                  <label>Acting as</label>
                  <div className="tabs">
                    <button className={`tab ${activeTrader === 'alice' ? 'active' : ''}`}
                      onClick={() => setActiveTrader('alice')}>Alice</button>
                    <button className={`tab ${activeTrader === 'bob' ? 'active' : ''}`}
                      onClick={() => setActiveTrader('bob')}>Bob</button>
                  </div>
                </div>
              )}

              {/* Order Book */}
              <div className="trade-actions">
                <h3>Order Book</h3>
                <p className="hint">
                  Limit orders from all participants. Maker identity is private (hidden in encrypted notes).
                  Click "Take" to fill an order.
                </p>
                {(() => {
                  const activeOrders = orders.filter((o) => !o.isConsumed)
                  const yesBids = activeOrders.filter((o) => o.isBuyYes).sort((a, b) => Number(b.price - a.price))
                  const noBids = activeOrders.filter((o) => !o.isBuyYes).sort((a, b) => Number(b.price - a.price))
                  return (
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: '200px' }}>
                        <h4 style={{ color: 'var(--green, #22c55e)' }}>YES Bids</h4>
                        {yesBids.length === 0 ? <p className="hint">No YES orders</p> : (
                          <table style={{ width: '100%', fontSize: '0.85rem' }}>
                            <thead><tr><th>Price</th><th>Amount</th><th></th></tr></thead>
                            <tbody>
                              {yesBids.map((o) => (
                                <tr key={o.orderId}>
                                  <td>${(Number(o.price) / 1_000_000).toFixed(2)}</td>
                                  <td>{o.amount.toString()}</td>
                                  <td>
                                    <button className="btn small" disabled={loading}
                                      onClick={() => handleTakeOrder(o.orderId)}>
                                      Take
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: '200px' }}>
                        <h4 style={{ color: 'var(--red, #ef4444)' }}>NO Bids</h4>
                        {noBids.length === 0 ? <p className="hint">No NO orders</p> : (
                          <table style={{ width: '100%', fontSize: '0.85rem' }}>
                            <thead><tr><th>Price</th><th>Amount</th><th></th></tr></thead>
                            <tbody>
                              {noBids.map((o) => (
                                <tr key={o.orderId}>
                                  <td>${(Number(o.price) / 1_000_000).toFixed(2)}</td>
                                  <td>{o.amount.toString()}</td>
                                  <td>
                                    <button className="btn small" disabled={loading}
                                      onClick={() => handleTakeOrder(o.orderId)}>
                                      Take
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )
                })()}
                <button className="btn small" onClick={() => withLogs(() => refreshOrders())} disabled={loading}
                  style={{ marginTop: '0.5rem' }}>
                  Refresh Orders
                </button>
              </div>

              {/* Place Order */}
              {!selectedMarket.isResolved && (
                <div className="trade-actions">
                  <h3>Place Limit Order</h3>
                  <p className="hint">
                    Place a limit order to buy YES or NO shares at your chosen price.
                    Your identity stays private -- only the price, amount, and side are visible.
                  </p>
                  <div className="form-group">
                    <label>Side</label>
                    <div className="tabs">
                      <button className={`tab ${orderSide === 'yes' ? 'active' : ''}`}
                        onClick={() => setOrderSide('yes')}>Buy YES</button>
                      <button className={`tab ${orderSide === 'no' ? 'active' : ''}`}
                        onClick={() => setOrderSide('no')}>Buy NO</button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Price per share ($0.01 - $0.99)</label>
                    <input type="number" step="0.01" min="0.01" max="0.99"
                      value={orderPrice} onChange={(e) => setOrderPrice(e.target.value)} disabled={loading} />
                  </div>
                  <div className="form-group">
                    <label>Number of shares</label>
                    <input type="number" value={orderAmount} onChange={(e) => setOrderAmount(e.target.value)} disabled={loading} />
                  </div>
                  <div className="hint" style={{ marginBottom: '0.5rem' }}>
                    Collateral cost: {(() => {
                      const p = BigInt(Math.round(parseFloat(orderPrice || '0') * 1_000_000))
                      const a = BigInt(orderAmount || '0')
                      return ((a * p) / PRICE_PRECISION).toString()
                    })()} tokens
                  </div>
                  <button className="btn primary" onClick={handlePlaceOrder} disabled={loading}>
                    {loading ? 'Placing...' : `Place ${orderSide.toUpperCase()} Order`}
                  </button>
                </div>
              )}

              {/* My Orders */}
              {orders.filter((o) => o.cancelSecret && !o.isConsumed).length > 0 && (
                <div className="trade-actions">
                  <h3>My Open Orders</h3>
                  <table style={{ width: '100%', fontSize: '0.85rem' }}>
                    <thead><tr><th>Side</th><th>Price</th><th>Amount</th><th></th></tr></thead>
                    <tbody>
                      {orders.filter((o) => o.cancelSecret && !o.isConsumed).map((o) => (
                        <tr key={o.orderId}>
                          <td>{o.isBuyYes ? 'YES' : 'NO'}</td>
                          <td>${(Number(o.price) / 1_000_000).toFixed(2)}</td>
                          <td>{o.amount.toString()}</td>
                          <td>
                            <button className="btn small" disabled={loading}
                              onClick={() => handleCancelOrder(o.orderId, o.cancelSecret!)}>
                              Cancel
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Your positions */}
              <div className="balances">
                {Object.entries(balances).map(([name, b]) => (
                  <div key={name} className="balance-card">
                    <h4>{name}</h4>
                    <div className="balance-row"><span>YES shares</span> <strong>{b.yes.toString()}</strong></div>
                    <div className="balance-row"><span>NO shares</span> <strong>{b.no.toString()}</strong></div>
                    <div className="balance-row"><span>Collateral tokens</span> <strong>{b.tokens.toString()}</strong></div>
                  </div>
                ))}
                <button className="btn small" onClick={() => withLogs(refreshBalances)} disabled={loading}>
                  Refresh Balances
                </button>
              </div>

              {/* Advanced: manual deposit/withdraw complete sets */}
              {!selectedMarket.isResolved && (
                <details className="advanced-section">
                  <summary>Advanced: Manual Deposit / Withdraw</summary>
                  <p className="hint">
                    Deposit collateral to get equal YES + NO shares, or return both to withdraw.
                  </p>
                  <div className="form-group">
                    <label>Amount</label>
                    <input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} disabled={loading} />
                  </div>
                  <div className="button-row">
                    <button className="btn" onClick={handleDeposit} disabled={loading}>
                      {loading ? 'Processing...' : 'Deposit (get YES+NO)'}
                    </button>
                    <button className="btn" onClick={handleWithdraw} disabled={loading}>
                      {loading ? 'Processing...' : 'Withdraw (return YES+NO)'}
                    </button>
                  </div>
                </details>
              )}

              {/* --- Claim payout (after resolution) --- */}
              {selectedMarket.isResolved && (() => {
                const traderKey = walletMode === 'extension' ? 'you' : activeTrader
                const traderBal = balances[traderKey]
                const winningBal = traderBal
                  ? (selectedMarket.outcome ? traderBal.yes : traderBal.no)
                  : 0n
                return (
                <div className="trade-actions">
                  <h3>Claim Payout</h3>
                  <p className="hint">
                    The market settled <strong>{selectedMarket.outcome ? 'YES' : 'NO'}</strong>.
                    If you hold winning shares, redeem them 1:1 for collateral tokens.
                    Losing shares are worthless.
                  </p>
                  <div className="form-group">
                    <label>Winning shares to redeem (you have {winningBal.toString()})</label>
                    <input type="number" value={redeemAmount} onChange={(e) => setRedeemAmount(e.target.value)} disabled={loading}
                      max={winningBal.toString()} />
                    {winningBal > 0n && redeemAmount !== winningBal.toString() && (
                      <button className="btn small" onClick={() => setRedeemAmount(winningBal.toString())}
                        style={{ marginTop: '0.25rem' }}>Max ({winningBal.toString()})</button>
                    )}
                  </div>
                  <button className="btn primary" onClick={handleRedeem}
                    disabled={loading || winningBal === 0n || BigInt(redeemAmount || '0') > winningBal}>
                    {loading ? 'Claiming...' : 'Claim Payout'}
                  </button>
                  {winningBal === 0n && traderBal && (
                    <p className="hint">No winning shares to redeem.</p>
                  )}
                </div>
                )
              })()}

              {/* --- Resolve --- */}
              {!selectedMarket.isResolved && (
                <div className="trade-actions">
                  <h3>Resolve Market</h3>
                  <p className="hint">
                    After expiry, anyone can resolve the market by submitting a zkTLS price attestation from CoinGecko.
                    The attestation is verified in a zero-knowledge circuit.
                  </p>
                  <button className="btn accent" onClick={() => setPhase('resolve')} disabled={loading}>
                    Submit Price Attestation
                  </button>
                </div>
              )}
            </section>
          )}

          {/* ===== RESOLVE ===== */}
          {phase === 'resolve' && (
            <section className="section">
              <h2>Resolve: {selectedMarket?.label}</h2>

              {/* Option 1: Generate attestation in-browser */}
              <div className="resolve-option">
                <h3>Fetch Current BTC Price</h3>
                <p className="hint">
                  Generate a zkTLS attestation of the current BTC/USD price from CoinGecko,
                  directly in your browser via Primus MPC-TLS.
                </p>
                <div className="form-group">
                  <label>CoinGecko API Key</label>
                  <input type="text" value={coinGeckoApiKey} onChange={(e) => setCoinGeckoApiKey(e.target.value)}
                    placeholder="CG-xxxxxxxxxxxxxxxxxxxx" disabled={loading} />
                  <p className="hint">
                    Free at{' '}
                    <a href="https://www.coingecko.com/en/api" target="_blank" rel="noreferrer">coingecko.com/api</a>
                    {' '}(10k calls/month). Needed to avoid rate limiting.
                  </p>
                </div>
                <div className="form-group">
                  <label>TLS Mode</label>
                  <select value={tlsMode} onChange={(e) => setTlsMode(e.target.value as 'proxytls' | 'mpctls')} disabled={loading}>
                    <option value="proxytls">Proxy TLS (fast, ~10s — attester proxies the TLS connection)</option>
                    <option value="mpctls">MPC TLS (slow, ~2min — neither party sees full TLS keys)</option>
                  </select>
                  <p className="hint">
                    Proxy TLS is faster and more reliable. MPC TLS provides stronger security
                    but may time out with some servers.
                  </p>
                </div>
                <details>
                  <summary className="hint">Advanced: Primus credentials</summary>
                  <div className="form-group" style={{ marginTop: '0.5rem' }}>
                    <label>Primus App ID</label>
                    <input type="text" value={primusAppId} onChange={(e) => setPrimusAppId(e.target.value)}
                      placeholder="0x..." disabled={loading} />
                  </div>
                  <div className="form-group">
                    <label>Primus App Secret</label>
                    <input type="password" value={primusAppSecret} onChange={(e) => setPrimusAppSecret(e.target.value)}
                      placeholder="0x..." disabled={loading} />
                    <p className="hint">
                      Defaults use shared example credentials. Get your own free at{' '}
                      <a href="https://dev.primuslabs.xyz" target="_blank" rel="noreferrer">dev.primuslabs.xyz</a>
                    </p>
                  </div>
                </details>
                <button className="btn primary" onClick={handleGenerateAttestation}
                  disabled={loading || !primusAppId.trim()} style={{ marginTop: '0.75rem' }}>
                  {loading ? 'Fetching BTC price...' : 'Fetch BTC Price Attestation'}
                </button>
              </div>

              <div className="divider"><span>or</span></div>

              {/* Option 2: Paste existing attestation */}
              <div className="resolve-option">
                <h3>Paste Existing Attestation</h3>
                <p className="hint">
                  If you already have an attestation JSON (e.g. generated via CLI), paste it below.
                </p>
                <div className="form-group">
                  <label>zkTLS Price Attestation (JSON)</label>
                  <textarea rows={6} value={attestationJson} onChange={(e) => setAttestationJson(e.target.value)}
                    placeholder='{"recipient": "0x...", "request": {...}, ...}' disabled={loading} />
                </div>
              </div>

              {/* Submit */}
              <div className="button-row" style={{ marginTop: '1.5rem' }}>
                <button className="btn primary" onClick={handleResolve}
                  disabled={loading || !attestationJson.trim()}>
                  {loading ? 'Resolving...' : 'Submit Attestation to Resolve Market'}
                </button>
                <button className="btn" onClick={() => setPhase('trade')} disabled={loading}>Back</button>
              </div>
            </section>
          )}
        </div>

        {/* Right Panel: Console */}
        <div className="panel log-panel">
          <h3>Console</h3>
          <div className="log-output">
            {logs.length === 0 ? (
              <p className="hint">No output yet. Connect a wallet to begin.</p>
            ) : (
              logs.map((line, i) => (
                <div key={i} className={`log-line ${
                  line.startsWith('[ERROR]') ? 'error' :
                  line.startsWith('[WARN]') ? 'warn' :
                  line.startsWith('[LOG]') ? 'log' : 'info'
                }`}>{line}</div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
          <button className="btn small" onClick={() => setLogs([])}>Clear</button>
        </div>
      </div>
    </div>
  )
}
