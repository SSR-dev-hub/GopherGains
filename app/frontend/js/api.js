const IS_APP = () => typeof window.electronAPI !== 'undefined'
const PROXY  = 'http://localhost:8742'

export async function loadCredentials() {
  try {
    if (IS_APP()) return await window.electronAPI.invoke('config:load', {})
    const r = await fetch(`${PROXY}/load-config`)
    return r.json()
  } catch { return { account_id: '', token: '' } }
}

export async function saveCredentials(account_id, token) {
  if (IS_APP()) return window.electronAPI.invoke('config:save', { account_id, token })
  const r = await fetch(`${PROXY}/save-config?account_id=${encodeURIComponent(account_id)}&token=${encodeURIComponent(token)}`)
  return r.json()
}

export async function loadTradesFromDisk() {
  try {
    if (IS_APP()) return await window.electronAPI.invoke('trades:load', {})
    const r = await fetch(`${PROXY}/trades`)
    return r.json()
  } catch { return { trades: [], total: 0, last_sync: '' } }
}

export async function loadTradesMeta() {
  const d      = await loadTradesFromDisk()
  const trades = d.trades || []
  const dates  = trades.map((r) => r.closeDate).filter(Boolean).sort()
  return {
    total:     d.total || 0,
    last_sync: d.last_sync || '',
    date_from: dates[0] || '',
    date_to:   dates[dates.length - 1] || '',
  }
}

export async function syncWithBroker(account_id, token) {
  if (IS_APP()) return window.electronAPI.invoke('trades:sync', { account_id, token })
  const r = await fetch(`${PROXY}/sync?account_id=${encodeURIComponent(account_id)}&token=${encodeURIComponent(token)}`)
  return r.json()
}

export async function importTradesAPI(rows) {
  if (IS_APP()) return window.electronAPI.invoke('trades:import', { rows })
  const r = await fetch(`${PROXY}/import-trades`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(rows),
  })
  return r.json()
}

export async function clearTradeLogsAPI() {
  if (IS_APP()) return window.electronAPI.invoke('trades:clearLogs', {})
  return fetch(`${PROXY}/clear-trades`)
}

export async function clearAllAPI() {
  if (IS_APP()) return window.electronAPI.invoke('trades:clearAll', {})
  return fetch(`${PROXY}/clear`)
}

export function parseCSVLine(line) {
  const fields = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQ = !inQ; continue }
    if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  fields.push(cur.trim())
  return fields
}

export function parseTradierCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('CSV appears empty')

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '_'))
  const idx = (candidates) => {
    for (const c of candidates) {
      const i = headers.findIndex((h) => h.includes(c))
      if (i !== -1) return i
    }
    return -1
  }

  const colSymbol   = idx(['symbol'])
  const colQty      = idx(['quantity', 'qty'])
  const colCost     = idx(['cost'])
  const colProceeds = idx(['proceeds'])
  const colGainLoss = idx(['gain_loss', 'gain_loss_', 'gain_loss__', 'gain_loss___'])
  const colGLPct    = idx(['gain_loss__', 'gain_loss_pct', 'gain_loss___', 'gain_loss_per'])
  const colClose    = idx(['close_date', 'closed_date', 'close_d'])
  const colTerm     = idx(['term'])

  if (colSymbol === -1 || colClose === -1 || colGainLoss === -1)
    throw new Error(`Missing required columns. Found: ${headers.join(', ')}`)

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const f = parseCSVLine(lines[i])
    if (f.length < 3) continue

    const symbol = (f[colSymbol] || '').trim()
    if (!symbol || symbol.toLowerCase() === 'null') continue

    let closeDate = (f[colClose] || '').trim().replace(/"/g, '')
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(closeDate)) {
      const [m, d, y] = closeDate.split('/')
      closeDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    } else {
      closeDate = closeDate.slice(0, 10)
    }
    if (!closeDate || closeDate < '2000-01-01') continue

    const qty      = colQty      !== -1 ? parseFloat(f[colQty])      || 0 : 0
    const cost     = colCost     !== -1 ? parseFloat(f[colCost])      || 0 : 0
    const proceeds = colProceeds !== -1 ? parseFloat(f[colProceeds])  || 0 : 0
    const gainLoss = parseFloat(f[colGainLoss]) || 0
    const glPct    = colGLPct   !== -1 ? parseFloat(f[colGLPct])     || 0 : 0
    const termRaw  = colTerm    !== -1 ? (f[colTerm] || '').toLowerCase() : ''
    const term     = termRaw.includes('long') ? 1 : 0

    rows.push({ symbol, quantity: qty, cost, proceeds, gainLoss, gainLossPct: glPct, closeDate, term, source: 'tradier' })
  }
  return rows
}
