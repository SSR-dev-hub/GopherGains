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
  const todayExp = today.slice(2).replace(/-/g, '') // "2026-05-28" → "260528"

  // Group legs by underlying+expiry, accumulate cash flow + open/close qty
  const groups = {}

  // ── Source A: orders API (multileg format, may lag by hours for new order types) ──
  const lookback = new Date(_t); lookback.setDate(lookback.getDate() - 5)
  const start    = `${lookback.getFullYear()}-${String(lookback.getMonth()+1).padStart(2,'0')}-${String(lookback.getDate()).padStart(2,'0')}`
  try {
    const data  = await get(`/v1/accounts/${accountId}/orders?includeTags=true&limit=10000&filter=all&start=${start}`, token)
    const raw   = data?.orders?.order
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
        const isLegOpening = leg.side && leg.side.includes('_to_open')
        if (!groups[key]) groups[key] = { ticker, expiry, cashFlow: 0, openQty: 0, closeQty: 0, optTypes: new Set(), fromPositions: false }
        const sign = leg.side.startsWith('sell') ? 1 : -1
        groups[key].cashFlow += sign * parseFloat(leg.avg_fill_price) * parseFloat(leg.exec_quantity) * 100
        groups[key].optTypes.add(optType)
        if (isLegOpening) groups[key].openQty  += parseFloat(leg.exec_quantity)
        else              groups[key].closeQty += parseFloat(leg.exec_quantity)
      }
    }
  } catch {}

  // ── Source B: positions API (real-time, catches orders that lag in orders API) ──
  try {
    const posData  = await get(`/v1/accounts/${accountId}/positions`, token)
    const rawPos   = posData?.positions?.position
    const positions = !rawPos || rawPos === 'null' ? [] : Array.isArray(rawPos) ? rawPos : [rawPos]

    for (const pos of positions) {
      const m = pos.symbol?.match(/^([A-Z]+)(\d{6})([CP])/)
      if (!m) continue
      const [, rawTicker, expiry, optType] = m
      if (expiry < todayExp) continue  // skip already-settled past positions

      const ticker = TICKER_ALIASES[rawTicker] || rawTicker
      const key    = `${ticker}|${expiry}`

      // cost_basis on short options: negative = credit received, positive = debit paid
      // Net contribution: -quantity × cost_basis × 100
      //   short (qty<0): -(-5) × (-3.01) × 100 = -$1505 if cost_basis<0  ← log to verify
      //   long  (qty>0): -(5) × (2.62) × 100  = -$1310
      const qty       = parseFloat(pos.quantity)
      const costBasis = parseFloat(pos.cost_basis)
      // Skip if this group came from the orders API — orders data is more accurate
      if (groups[key] && !groups[key].fromPositions) continue

      if (!groups[key]) groups[key] = { ticker, expiry, cashFlow: 0, openQty: 0, closeQty: 0, optTypes: new Set(), fromPositions: true, spreadQty: 0 }

      // cost_basis is already the total dollar amount for all contracts in this leg
      // Short (qty<0): cost_basis<0 (credit received) → -cost_basis = positive P&L contribution
      // Long  (qty>0): cost_basis>0 (debit paid)      → -cost_basis = negative P&L contribution
      groups[key].cashFlow  += -costBasis
      groups[key].optTypes.add(optType)
      groups[key].openQty   += Math.abs(qty)
      // all legs of a spread have the same |qty|, so max gives the spread contract count
      groups[key].spreadQty  = Math.max(groups[key].spreadQty, Math.abs(qty))
    }
  } catch {}

  const spreads = []

  for (const { ticker, expiry, cashFlow, openQty, closeQty, optTypes, fromPositions, spreadQty } of Object.values(groups)) {
    const include = expiry === todayExp
      ? true
      : expiry > todayExp && openQty > 0 && closeQty >= openQty

    if (!include) continue

    const type     = optTypes.has('C') && optTypes.has('P') ? 'IC' : optTypes.has('C') ? 'CS' : 'PS'
    const numLegs  = type === 'IC' ? 4 : 2
    const qty      = fromPositions ? spreadQty : Math.round(openQty / numLegs)
    const fullyClosed = closeQty >= openQty
    spreads.push({ ticker, expiry, type, qty, pnl: Math.round(cashFlow * 100) / 100, fullyClosed })
  }

  if (!spreads.length) return null

  const totalPnl  = Math.round(spreads.reduce((s, r) => s + r.pnl, 0) * 100) / 100
  const allClosed = spreads.every((s) => s.fullyClosed)
  return { date: today, totalPnl, spreads, allClosed }
}

module.exports = { syncTrades, fetchTodayOrders }
