'use strict'

const https = require('https')

const BASE_URL    = 'api.tradier.com'
const OVERLAP_DAYS = 7

function mapRow(p) {
  return {
    symbol:      p.symbol       ?? '',
    quantity:    parseFloat(p.quantity         ?? 0),
    cost:        parseFloat(p.cost             ?? 0),
    proceeds:    parseFloat(p.proceeds         ?? 0),
    gainLoss:    parseFloat(p.gain_loss        ?? 0),
    gainLossPct: parseFloat(p.gain_loss_percent ?? 0),
    closeDate:   (p.close_date  ?? '').slice(0, 10),
    term:        parseInt(p.term ?? 0, 10),
    source:      'tradier',
  }
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      path,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }
    https.get(options, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode === 403) return reject(new Error('403'))
        if (res.statusCode === 404) return reject(new Error('404'))
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()))
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

async function syncTrades(accountId, token, existing) {
  let cutoff = '2020-01-01'
  if (existing.length > 0) {
    const latest = existing.reduce((max, r) =>
      (r.closeDate ?? '') > max ? (r.closeDate ?? '') : max, '')
    if (latest) {
      const d = new Date(latest)
      d.setDate(d.getDate() - OVERLAP_DAYS)
      cutoff = d.toISOString().slice(0, 10)
    }
  }

  const LIMIT = 100
  const newRows = []
  let page = 1
  let pagesFetched = 0
  let done = false

  while (!done) {
    const path = `/v1/accounts/${accountId}/gainloss?page=${page}&limit=${LIMIT}&sortBy=closeDate&sort=desc`
    let data
    try {
      data = await get(path, token)
    } catch (e) {
      const msg = e.message ?? String(e)
      if (msg.includes('403')) return { error: 'Invalid API token — check Settings' }
      if (msg.includes('404')) return { error: 'Account ID not found — check Settings' }
      return { error: `Tradier API error: ${msg}` }
    }

    const gl = data?.gainloss
    if (!gl) break

    let positions = gl.closed_position ?? []
    if (!Array.isArray(positions)) positions = [positions]

    console.log(`  [Tradier] page ${page}: ${positions.length} positions`)
    pagesFetched++

    for (const p of positions) {
      const row = mapRow(p)
      if (!row.closeDate) continue
      if (row.closeDate < cutoff) { done = true; break }
      newRows.push(row)
    }

    if (!done && positions.length < LIMIT) done = true
    page++
  }

  const dates = newRows.map((r) => r.closeDate).filter(Boolean)
  return {
    newRows,
    cutoff,
    pagesFetched,
    latestDate:   dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : '—',
    earliestDate: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : '—',
  }
}

const TICKER_ALIASES = { SPXW: 'SPX', NDXP: 'NDX', DJXW: 'DJX', RUTW: 'RUT', NQXP: 'NQX' }

async function fetchTodayOrders(accountId, token) {
  const _t       = new Date()
  const today    = `${_t.getFullYear()}-${String(_t.getMonth()+1).padStart(2,'0')}-${String(_t.getDate()).padStart(2,'0')}`
  const todayExp = today.slice(2).replace(/-/g, '') // "2026-06-05" → "260605"

  const groups = {}

  // ── Source A: account history (past sessions — updates once session closes) ──
  // Gives real-time access to yesterday+ trades before gainloss API settles (T+1)
  try {
    const data   = await get(`/v1/accounts/${accountId}/history?limit=500&type=trade`, token)
    const evRaw  = data?.history?.event
    const events = !evRaw || evRaw === 'null' ? [] : Array.isArray(evRaw) ? evRaw : [evRaw]

    for (const e of events) {
      const trade = e?.trade
      if (!trade || trade.trade_type !== 'option') continue
      const sym = trade.symbol ?? ''
      const m = sym.match(/^([A-Z]+)(\d{6})([CP])/)
      if (!m) continue
      const [, rawTicker, expiry, optType] = m
      if (expiry === todayExp) continue  // today's session handled by orders API below

      const ticker = TICKER_ALIASES[rawTicker] || rawTicker
      const key    = `${ticker}|${expiry}`
      const qty    = parseFloat(trade.quantity ?? 0)
      const price  = parseFloat(trade.price   ?? 0)

      if (!groups[key]) groups[key] = { ticker, expiry, cashFlow: 0, optTypes: new Set(), fromHistory: true, netQtyBySymbol: {} }
      // cashFlow: short(qty<0)=credit(+), long(qty>0)=debit(-)
      groups[key].cashFlow += -qty * price * 100
      groups[key].optTypes.add(optType)
      // Net signed qty per symbol: opens accumulate, closes cancel out → remaining = open interest
      groups[key].netQtyBySymbol[sym] = (groups[key].netQtyBySymbol[sym] ?? 0) + qty
    }
  } catch {}

  // ── Source B: orders API (current session — today's filled multileg orders) ──
  try {
    const data   = await get(`/v1/accounts/${accountId}/orders?includeTags=true&limit=10000`, token)
    const raw    = data?.orders?.order
    const orders = !raw || raw === 'null' ? [] : Array.isArray(raw) ? raw : [raw]

    for (const order of orders) {
      if (order.status !== 'filled') continue

      let legsToProcess = []
      if (order.class === 'multileg' && order.leg) {
        legsToProcess = Array.isArray(order.leg) ? order.leg : [order.leg]
      } else if (order.class === 'option' && order.parent_id) {
        legsToProcess = [{
          option_symbol:  order.option_symbol,
          side:           order.side,
          exec_quantity:  order.filled_quantity ?? order.exec_quantity ?? order.quantity,
          avg_fill_price: order.avg_fill_price,
        }]
      } else {
        continue
      }

      for (const leg of legsToProcess) {
        if (!leg.option_symbol || !leg.exec_quantity || !leg.avg_fill_price) continue
        const m = leg.option_symbol.match(/^([A-Z]+)(\d{6})([CP])/)
        if (!m) continue
        const [, rawTicker, expiry, optType] = m
        const ticker = TICKER_ALIASES[rawTicker] || rawTicker
        const key    = `${ticker}|${expiry}`
        // Orders data takes priority — clear any history-based entry for this expiry
        if (groups[key]?.fromHistory) delete groups[key]
        const isLegOpening = leg.side && leg.side.includes('_to_open')
        if (!groups[key]) groups[key] = { ticker, expiry, cashFlow: 0, openQty: 0, closeQty: 0, optTypes: new Set(), fromHistory: false }
        const sign = leg.side.startsWith('sell') ? 1 : -1
        groups[key].cashFlow += sign * parseFloat(leg.avg_fill_price) * parseFloat(leg.exec_quantity) * 100
        groups[key].optTypes.add(optType)
        if (isLegOpening) groups[key].openQty  += parseFloat(leg.exec_quantity)
        else              groups[key].closeQty += parseFloat(leg.exec_quantity)
      }
    }
  } catch {}

  // ── Source C: positions API (fallback for today's open positions not yet in orders) ──
  try {
    const posData   = await get(`/v1/accounts/${accountId}/positions`, token)
    const rawPos    = posData?.positions?.position
    const positions = !rawPos || rawPos === 'null' ? [] : Array.isArray(rawPos) ? rawPos : [rawPos]

    for (const pos of positions) {
      const m = pos.symbol?.match(/^([A-Z]+)(\d{6})([CP])/)
      if (!m) continue
      const [, rawTicker, expiry, optType] = m
      if (expiry < todayExp) continue
      const ticker    = TICKER_ALIASES[rawTicker] || rawTicker
      const key       = `${ticker}|${expiry}`
      if (groups[key] && !groups[key].fromHistory) continue  // orders data takes priority
      const qty       = parseFloat(pos.quantity)
      const costBasis = parseFloat(pos.cost_basis)
      if (!groups[key]) groups[key] = { ticker, expiry, cashFlow: 0, openQty: 0, closeQty: 0, optTypes: new Set(), fromHistory: false, spreadQty: 0 }
      groups[key].cashFlow  += -costBasis
      groups[key].optTypes.add(optType)
      groups[key].openQty   += Math.abs(qty)
      groups[key].spreadQty  = Math.max(groups[key].spreadQty ?? 0, Math.abs(qty))
    }
  } catch {}

  // Build one result entry per expiry date
  const byDate = {}

  for (const group of Object.values(groups)) {
    const { ticker, expiry, cashFlow, optTypes, fromHistory, openQty, closeQty, spreadQty } = group

    let include
    if (fromHistory) {
      include = true  // history is authoritative for past sessions; render.js filters settled dates
    } else {
      include = expiry <= todayExp ? openQty > 0 : openQty > 0 && closeQty >= openQty
    }
    if (!include) continue

    const type    = optTypes.has('C') && optTypes.has('P') ? 'IC' : optTypes.has('C') ? 'CS' : 'PS'
    const numLegs = type === 'IC' ? 4 : 2

    let qty
    if (fromHistory) {
      // Max abs net qty across symbols: opens accumulate, closes cancel → remaining = contract count
      // e.g. IC expired: net ±5 per leg → qty=5. IC closed: net 0 → use max anyway for display
      const vals = Object.values(group.netQtyBySymbol ?? {}).map(Math.abs)
      qty = vals.length ? Math.max(...vals) : 0
    } else if (spreadQty) {
      qty = spreadQty
    } else {
      qty = Math.round(openQty / numLegs)
    }

    const fullyClosed = fromHistory ? true : closeQty >= openQty
    const pnl         = Math.round(cashFlow * 100) / 100
    const date        = `20${expiry.slice(0, 2)}-${expiry.slice(2, 4)}-${expiry.slice(4, 6)}`

    if (!byDate[date]) byDate[date] = { date, spreads: [], allClosed: true }
    byDate[date].spreads.push({ ticker, expiry, type, qty, pnl, fullyClosed })
    if (!fullyClosed) byDate[date].allClosed = false
  }

  const result = Object.values(byDate).map(({ date, spreads, allClosed }) => ({
    date,
    totalPnl: Math.round(spreads.reduce((s, r) => s + r.pnl, 0) * 100) / 100,
    spreads,
    allClosed,
  }))

  console.log(`  [Tradier] fetchTodayOrders: ${result.length} unsettled dates — ${result.map((r) => r.date).join(', ')}`)
  return result.length ? result : null
}

module.exports = { syncTrades, fetchTodayOrders }
