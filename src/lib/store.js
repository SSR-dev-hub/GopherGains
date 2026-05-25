'use strict'

const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { safeStorage } = require('electron')

const DATA_DIR    = path.join(os.homedir(), '.gophergains')
const TRADES_FILE = path.join(DATA_DIR, 'trades.json')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')

// Encrypted file format: { v: 1, d: "<base64>" }
// Legacy files (plain JSON) are detected by the absence of { v, d }
// and automatically re-written in encrypted form on first load.

function readEncrypted(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (raw && raw.v === 1 && typeof raw.d === 'string') {
    return { json: safeStorage.decryptString(Buffer.from(raw.d, 'base64')), legacy: false }
  }
  return { json: JSON.stringify(raw), legacy: true }
}

function writeEncrypted(filePath, str) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const enc = safeStorage.encryptString(str)
  fs.writeFileSync(filePath, JSON.stringify({ v: 1, d: enc.toString('base64') }), 'utf8')
}

function loadTrades() {
  try {
    const { json, legacy } = readEncrypted(TRADES_FILE)
    const data = JSON.parse(json)
    const trades = Array.isArray(data) ? data : []
    if (legacy) saveTrades(trades)
    return trades
  } catch {
    return []
  }
}

function saveTrades(trades) {
  const sorted = [...trades].sort((a, b) =>
    (b.closeDate ?? '').localeCompare(a.closeDate ?? '')
  )
  writeEncrypted(TRADES_FILE, JSON.stringify(sorted))
}

function loadConfig() {
  try {
    const { json, legacy } = readEncrypted(CONFIG_FILE)
    const cfg = JSON.parse(json)
    if (legacy) saveConfig(cfg)
    return cfg ?? {}
  } catch {
    return {}
  }
}

function saveConfig(cfg) {
  writeEncrypted(CONFIG_FILE, JSON.stringify(cfg, null, 2))
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
