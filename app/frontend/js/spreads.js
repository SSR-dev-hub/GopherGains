import { getUnderlying, getStrikeNum, prettyExpiry } from './utils.js'
import { TYPE_CHIP_LABEL, TYPE_BADGE_CLS, TYPE_FULL_LABEL, TICKER_CLS_MAP } from './constants.js'

export function parseSymbol(r) {
  const sym      = r.symbol || ''
  const qty      = Math.abs(r.quantity)
  const side     = r.quantity < 0 ? 'short' : 'long'
  const pnl      = parseFloat(r.gainLoss) || 0
  const ticker   = getUnderlying(sym)
  const isOption = /\d{6}[CP]\d+/.test(sym)

  let optType = isOption ? '?' : 'STOCK'
  if (isOption) {
    const m = sym.match(/\d{6}([PC])\d+/)
    if (m) optType = m[1]
  }

  let strike = ''
  const sm = sym.match(/[PC](\d+)$/)
  if (sm) {
    const raw = parseInt(sm[1])
    if (raw >= 1000000)    strike = (raw / 1000).toFixed(0)
    else if (raw >= 10000) strike = (raw / 1000).toFixed(0)
    else                   strike = raw.toString()
  }

  return { ticker, optType, strike, qty, side, pnl, sym, isOption }
}

export function groupIntoSpreads(dayRows) {
  const buckets       = {}
  const stockByTicker = {}

  dayRows.forEach((r) => {
    const p = parseSymbol(r)
    if (p.optType === 'STOCK') {
      if (!stockByTicker[p.ticker]) stockByTicker[p.ticker] = { ticker: p.ticker, pnl: 0, qty: 0, rows: [] }
      stockByTicker[p.ticker].pnl += p.pnl
      stockByTicker[p.ticker].qty += Math.abs(r.quantity)
      stockByTicker[p.ticker].rows.push(r)
      return
    }
    const em     = (r.symbol || '').match(/[A-Z]+(\d{6})[CP]/)
    const expiry = em ? em[1] : 'X'
    const bkey   = p.ticker + '|' + expiry
    if (!buckets[bkey]) buckets[bkey] = { ticker: p.ticker, expiry, P: [], C: [], rawP: [], rawC: [], pnl: 0 }
    if (p.optType === 'C') { buckets[bkey].C.push(p); buckets[bkey].rawC.push(r) }
    else                   { buckets[bkey].P.push(p); buckets[bkey].rawP.push(r) }
    buckets[bkey].pnl += p.pnl
  })

  const result = []

  Object.values(stockByTicker).forEach((s) => {
    result.push({ ticker: s.ticker, optType: 'STOCK', legs: s.rows, pnl: s.pnl, expiry: '', qty: s.qty })
  })

  Object.values(buckets).forEach((b) => {
    const hasP   = b.P.length > 0
    const hasC   = b.C.length > 0
    const pShort = b.rawP.filter((r) => r.quantity < 0).reduce((a, r) => a + Math.abs(r.quantity), 0)
    const pLong  = b.rawP.filter((r) => r.quantity > 0).reduce((a, r) => a + Math.abs(r.quantity), 0)
    const cShort = b.rawC.filter((r) => r.quantity < 0).reduce((a, r) => a + Math.abs(r.quantity), 0)
    const cLong  = b.rawC.filter((r) => r.quantity > 0).reduce((a, r) => a + Math.abs(r.quantity), 0)

    if (hasP && hasC) {
      const qty = Math.min(pShort || 1, cShort || 1)
      result.push({ ticker: b.ticker, optType: 'IC', legs: [...b.P, ...b.C], pLegs: b.P, cLegs: b.C, pnl: b.pnl, expiry: b.expiry, qty })
    } else if (hasP) {
      const isMultiLeg = pShort > 0 && pLong > 0
      const qty = isMultiLeg ? pShort : (pShort || pLong || 1)
      result.push({ ticker: b.ticker, optType: isMultiLeg ? 'PS' : 'P', legs: b.P, pnl: b.pnl, expiry: b.expiry, qty })
    } else {
      const isMultiLeg = cShort > 0 && cLong > 0
      const qty = isMultiLeg ? cShort : (cShort || cLong || 1)
      result.push({ ticker: b.ticker, optType: isMultiLeg ? 'CS' : 'C', legs: b.C, pnl: b.pnl, expiry: b.expiry, qty })
    }
  })

  return result.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
}

export function buildBatches(pRaw, cRaw) {
  const allRaw = [...pRaw, ...cRaw]
  const byQty  = {}
  allRaw.forEach((r) => {
    const k = Math.abs(r.quantity)
    if (!byQty[k]) byQty[k] = { qty: k, pShort: [], pLong: [], cShort: [], cLong: [] }
    const isPut = /\d{6}P/.test(r.symbol || '')
    if (isPut) { r.quantity < 0 ? byQty[k].pShort.push(r) : byQty[k].pLong.push(r) }
    else       { r.quantity < 0 ? byQty[k].cShort.push(r) : byQty[k].cLong.push(r) }
  })

  const result = []
  Object.values(byQty).sort((a, b) => b.qty - a.qty).forEach((b) => {
    const fillCount = Math.max(b.pShort.length, b.pLong.length, b.cShort.length, b.cLong.length, 1)
    for (let i = 0; i < fillCount; i++) {
      const legs = [b.pShort[i], b.pLong[i], b.cShort[i], b.cLong[i]].filter(Boolean)
      const pnl  = legs.reduce((s, r) => s + r.gainLoss, 0)
      result.push({
        qty:            b.qty,
        netPerContract: pnl / b.qty,
        pnl,
        pShortStr: b.pShort[i] ? getStrikeNum(b.pShort[i].symbol) : undefined,
        pLongStr:  b.pLong[i]  ? getStrikeNum(b.pLong[i].symbol)  : undefined,
        cShortStr: b.cShort[i] ? getStrikeNum(b.cShort[i].symbol) : undefined,
        cLongStr:  b.cLong[i]  ? getStrikeNum(b.cLong[i].symbol)  : undefined,
      })
    }
  })
  return result
}

export function calChip(spread) {
  const { ticker, optType, pnl, qty } = spread
  const tickerCls = TICKER_CLS_MAP[ticker] || 'other'
  const chipLabel = TYPE_CHIP_LABEL[optType] || optType
  const sign      = pnl >= 0 ? '+' : ''
  return `<div class="cal-trade-chip">
    <span class="cal-chip-ticker ${tickerCls}">${ticker}</span>
    ${chipLabel ? `<span class="cal-chip-type ${TYPE_BADGE_CLS[optType] || ''}">${chipLabel}</span>` : ''}
    <span class="cal-chip-qty">×${qty || '?'}</span>
    <span class="cal-chip-pnl ${pnl >= 0 ? 'pos' : 'neg'}">${sign}${Math.round(pnl)}</span>
  </div>`
}

export function buildSpreadCard(s, rawByKey) {
  const tickerCls = TICKER_CLS_MAP[s.ticker] || 'other'
  const typeTag   = TYPE_BADGE_CLS[s.optType] || ''
  const label     = TYPE_CHIP_LABEL[s.optType] || s.optType
  const key       = s.ticker + '|' + s.expiry
  const raw       = rawByKey[key] || { P: [], C: [] }
  const expStr    = s.expiry ? prettyExpiry(s.expiry) : ''
  const batches   = s.optType === 'STOCK' ? [] : buildBatches(raw.P, raw.C)
  const b0        = batches[0] || {}

  let strikeStr = ''
  if (s.optType === 'IC') {
    const pWing = [b0.pShortStr, b0.pLongStr].filter(Boolean).join('/')
    const cWing = [b0.cShortStr, b0.cLongStr].filter(Boolean).join('/')
    strikeStr = `<span class="lc-strike put">P ${pWing}</span><span class="lc-sep">↔</span><span class="lc-strike call">C ${cWing}</span>`
  } else if (s.optType === 'PS') {
    strikeStr = `<span class="lc-strike put">${b0.pShortStr}/${b0.pLongStr}</span>`
  } else if (s.optType === 'CS') {
    strikeStr = `<span class="lc-strike call">${b0.cShortStr}/${b0.cLongStr}</span>`
  } else if (s.optType === 'P') {
    const strike = b0.pShortStr || b0.pLongStr
    if (strike) strikeStr = `<span class="lc-strike put">${strike}</span>`
  } else if (s.optType === 'C') {
    const strike = b0.cShortStr || b0.cLongStr
    if (strike) strikeStr = `<span class="lc-strike call">${strike}</span>`
  }

  let fillChips = ''
  if (s.optType === 'STOCK') {
    fillChips = `<span class="lc-fill-chip"><span class="lc-fill-qty">×${s.qty} shares</span></span>`
  } else {
    fillChips = batches.map((b) => {
      const net    = b.netPerContract
      const netStr = (net >= 0 ? '+$' : '-$') + Math.abs(net).toFixed(2)
      const pnlStr = (b.pnl >= 0 ? '+$' : '-$') + Math.abs(Math.round(b.pnl))
      return `<span class="lc-fill-chip">
        <span class="lc-fill-qty">×${b.qty}</span>
        <span class="lc-fill-net">${netStr}/c</span>
        <span class="lc-fill-pnl ${b.pnl >= 0 ? 'pos' : 'neg'}">${pnlStr}</span>
      </span>`
    }).join('<span class="lc-fill-divider">·</span>')
  }

  const pnlStr = (s.pnl >= 0 ? '+$' : '-$') + Math.abs(Math.round(s.pnl))
  return `<div class="lc-row">
    <span class="cal-chip-ticker ${tickerCls} lc-ticker">${s.ticker}</span>
    ${label ? `<span class="badge ${typeTag} lc-badge">${label}</span>` : ''}
    ${expStr ? `<span class="lc-meta">${expStr}</span>` : ''}
    <span class="lc-strikes">${strikeStr}</span>
    <span class="lc-fills">${fillChips}</span>
    <span class="lc-pnl ${s.pnl >= 0 ? 'pos' : 'neg'}">${pnlStr}</span>
  </div>`
}
