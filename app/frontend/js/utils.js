import { TICKER_ALIASES } from './constants.js'
import { state } from './state.js'

export function fmt(n, decimals = 2) {
  const abs = Math.abs(n).toFixed(decimals)
  const formatted = Number(abs).toLocaleString('en-US', { minimumFractionDigits: decimals })
  return (n >= 0 ? '$' : '−$') + formatted
}

export function fmtPct(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}

export function getUnderlying(sym) {
  if (!sym || sym === 'null') return 'OTHER'
  const m = sym.match(/^([A-Z]+)/)
  if (!m) return 'OTHER'
  return TICKER_ALIASES[m[1]] || m[1]
}

export function prettyExpiry(raw) {
  if (!raw || raw === 'X') return '—'
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const yy = raw.slice(0, 2), mm = parseInt(raw.slice(2, 4)) - 1, dd = raw.slice(4, 6)
  return `${parseInt(dd)} ${months[mm]} '${yy}`
}

export function getStrikeNum(sym) {
  const m = (sym || '').match(/[PC](\d+)$/)
  if (!m) return 0
  const raw = parseInt(m[1])
  return raw >= 1000000 ? raw / 1000 : raw
}

export function allRows() {
  return state.rows.map((r) => ({ ...r }))
}

export function allSeries() {
  if (!state.rows.length) return []
  const byDate = {}
  state.rows.forEach((t) => {
    const pnl = parseFloat(t.gainLoss) || 0
    byDate[t.closeDate] = (byDate[t.closeDate] || 0) + pnl
  })
  const dates = Object.keys(byDate).sort()
  let running = 0
  return dates.map((d) => {
    running += byDate[d]
    return {
      date:       d,
      daily:      Math.round(byDate[d] * 100) / 100,
      cumulative: Math.round(running * 100) / 100,
    }
  })
}
