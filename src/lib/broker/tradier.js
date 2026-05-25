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

module.exports = { syncTrades }
