'use strict'

const { ipcMain, app } = require('electron')
const store  = require('./store')
const broker = require('./broker')
const { mergeDedup } = require('./dedup')

function registerIpcHandlers() {
  ipcMain.handle('trades:load', () => {
    const trades = store.loadTrades()
    const cfg    = store.loadConfig()
    return { trades, total: trades.length, last_sync: cfg.last_sync ?? '' }
  })

  ipcMain.handle('trades:sync', async (_event, { account_id, token }) => {
    const existing = store.loadTrades()
    const result   = await broker.syncTrades(account_id, token, existing)
    if (result.error) return result

    const { newRows, cutoff, pagesFetched, latestDate, earliestDate } = result
    const kept   = existing.filter((r) => (r.closeDate ?? '') < cutoff)
    const unique = mergeDedup(kept, newRows)

    store.saveTrades(unique)
    const cfg       = store.loadConfig()
    cfg.last_sync   = new Date().toISOString()
    store.saveConfig(cfg)

    const added = Math.max(0, unique.length - existing.length)
    console.log(`  [Sync] done — ${added} new, ${unique.length} total, cutoff=${cutoff}, pages=${pagesFetched}`)
    return {
      added,
      total:         unique.length,
      latest_date:   latestDate,
      earliest_date: earliestDate,
      pages_fetched: pagesFetched,
      last_sync:     cfg.last_sync,
      cutoff,
    }
  })

  ipcMain.handle('trades:import', (_event, { rows }) => {
    const incoming = Array.isArray(rows) ? rows : []
    const existing = store.loadTrades()
    const unique   = mergeDedup(existing, incoming)

    store.saveTrades(unique)
    const cfg     = store.loadConfig()
    cfg.last_sync = new Date().toISOString()
    store.saveConfig(cfg)

    const dates         = unique.map((r) => r.closeDate).filter(Boolean)
    const latestDate    = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : '—'
    const earliestDate  = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : '—'
    const added         = unique.length - existing.length

    console.log(`  [Import] ${incoming.length} rows in, ${added} new, ${unique.length} total`)
    return {
      added,
      total:         unique.length,
      latest_date:   latestDate,
      earliest_date: earliestDate,
      last_sync:     cfg.last_sync,
    }
  })

  ipcMain.handle('trades:today', async (_event, { account_id, token }) => {
    try {
      const result = await broker.fetchTodayOrders(account_id, token)
      return result ?? null
    } catch (e) {
      console.error('[Today]', e.message)
      return null
    }
  })

  ipcMain.handle('trades:clearLogs', () => {
    store.clearTrades()
    return { ok: true }
  })

  ipcMain.handle('trades:clearAll', () => {
    store.clearAll()
    return { ok: true }
  })

  ipcMain.handle('config:load', () => {
    const cfg = store.loadConfig()
    return { account_id: cfg.account_id ?? '', token: cfg.token ?? '' }
  })

  ipcMain.handle('config:save', (_event, { account_id, token }) => {
    const cfg = store.loadConfig()
    cfg.account_id = account_id
    cfg.token      = token
    store.saveConfig(cfg)
    return { ok: true }
  })

  ipcMain.handle('app:version', () => ({
    version: app.getVersion(),
  }))
}

module.exports = { registerIpcHandlers }
