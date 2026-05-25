'use strict'

const fs   = require('fs')
const path = require('path')
const os   = require('os')

const DATA_DIR    = path.join(os.homedir(), '.gophergains')
const TRADES_FILE = path.join(DATA_DIR, 'trades.json')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')

function loadTrades() {
  try {
    const data = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function saveTrades(trades) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const sorted = [...trades].sort((a, b) =>
    (b.closeDate ?? '').localeCompare(a.closeDate ?? '')
  )
  fs.writeFileSync(TRADES_FILE, JSON.stringify(sorted), 'utf8')
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
}

function clearTrades() {
  try { fs.unlinkSync(TRADES_FILE) } catch { /* already gone */ }
}

function clearAll() {
  for (const f of [TRADES_FILE, CONFIG_FILE]) {
    try { fs.unlinkSync(f) } catch { /* already gone */ }
  }
}

module.exports = { loadTrades, saveTrades, loadConfig, saveConfig, clearTrades, clearAll }
