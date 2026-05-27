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
  const todayExp = today.slice(2).replace(/-/g, '') // "2026-05-26" → "260526"

  // Look back 5 days to catch multi-day positions expiring today that were never closed
  const lookback = new Date(_t); lookback.setDate(lookback.getDate() - 5)
  const start    = `${lookback.getFullYear()}-${String(lookback.getMonth()+1).padStart(2,'0')}-${String(lookback.getDate()).padStart(2,'0')}`

  let data
  try {
    data = await get(
      `/v1/accounts/${accountId}/orders?includeTags=true&limit=10000&filter=all&start=${start}`,
      token
    )
  } catch { return null }

  const raw = data?.orders?.order
  if (!raw || raw === 'null') return null
  const orders = Array.isArray(raw) ? raw : [raw]

  // Group legs by underlying+expiry, accumulate cash flow + open/close qty
  const groups = {}

  for (const order of orders) {
    if (order.status !== 'filled') continue
    if (order.class !== 'multileg') continue
    if (!order.leg) continue

    const legs = Array.isArray(order.leg) ? order.leg : [order.leg]
    const isOpening = legs.some((l) => l.side && l.side.includes('_to_open'))

    for (const leg of legs) {
      if (!leg.option_symbol || !leg.exec_quantity || !leg.avg_fill_price) continue

      const m = leg.option_symbol.match(/^([A-Z]+)(\d{6})([CP])/)
      if (!m) continue
      const [, rawTicker, expiry, optType] = m

      const ticker = TICKER_ALIASES[rawTicker] || rawTicker
      const key    = `${ticker}|${expiry}`

      if (!groups[key]) groups[key] = { ticker, expiry, cashFlow: 0, openQty: 0, closeQty: 0, optTypes: new Set() }

      // sell = credit (+), buy = debit (-)
      const sign = leg.side.startsWith('sell') ? 1 : -1
      groups[key].cashFlow += sign * leg.avg_fill_price * leg.exec_quantity * 100
      groups[key].optTypes.add(optType)

      if (isOpening) groups[key].openQty  += leg.exec_quantity
      else           groups[key].closeQty += leg.exec_quantity
    }
  }

  const spreads = []

  for (const { ticker, expiry, cashFlow, openQty, closeQty, optTypes } of Object.values(groups)) {
    const include = expiry === todayExp
      // Rule 1 & 2: today's expiry — always include (unclosed qty expired worthless = full credit kept)
      ? true
      // Rule 3: future expiry — only if opened AND fully closed today
      : openQty > 0 && closeQty >= openQty

    if (!include) continue

    const type = optTypes.has('C') && optTypes.has('P') ? 'IC'
               : optTypes.has('C') ? 'CS' : 'PS'

    const fullyClosed = closeQty >= openQty
    spreads.push({ ticker, expiry, type, pnl: Math.round(cashFlow * 100) / 100, fullyClosed })
  }

  if (!spreads.length) return null

  const totalPnl  = Math.round(spreads.reduce((s, r) => s + r.pnl, 0) * 100) / 100
  const allClosed = spreads.every((s) => s.fullyClosed)
  return { date: today, totalPnl, spreads, allClosed }
}

module.exports = { syncTrades, fetchTodayOrders }
