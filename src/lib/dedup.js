'use strict'

function tradeKey(row) {
  return JSON.stringify([
    row.symbol    ?? '',
    row.closeDate ?? '',
    row.quantity  ?? 0,
    row.cost      ?? 0,
    row.gainLoss  ?? 0,
  ])
}

function mergeDedup(existing, incoming) {
  const group = (rows) => {
    const g = new Map()
    for (const row of rows) {
      const k = tradeKey(row)
      if (!g.has(k)) g.set(k, [])
      g.get(k).push(row)
    }
    return g
  }

  const exG = group(existing)
  const inG = group(incoming)
  const allKeys = new Set([...exG.keys(), ...inG.keys()])

  const result = []
  for (const k of allKeys) {
    const exCopies = exG.get(k) ?? []
    const inCopies = inG.get(k) ?? []
    // prefer whichever source has more copies; ties → existing
    result.push(...(inCopies.length > exCopies.length ? inCopies : exCopies))
  }
  return result
}

module.exports = { mergeDedup }
