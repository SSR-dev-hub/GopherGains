import { state } from './state.js'
import { allSeries } from './utils.js'
import { applyTheme } from './charts.js'
import {
  renderDashboard, renderCalendar, renderLog, renderUnderlying,
  calNav, openDayModal, closeModal, setLogView, clearLogDates,
  populateLogFilters,
} from './render.js'
import {
  loadCredentials, saveCredentials, loadTradesFromDisk, loadTradesMeta,
  syncWithBroker, importTradesAPI, clearTradeLogsAPI, clearAllAPI,
  parseTradierCSV,
} from './api.js'

// ── Navigation ────────────────────────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard: ['Dashboard', '/ overview'],
  calendar:  ['Calendar',  '/ daily P&L'],
  log:       ['Trade Log', '/ all trades'],
  settings:  ['Settings',  '/ tradier sync'],
}

function showPage(id, el) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'))
  document.querySelectorAll('nav a').forEach((a) => a.classList.remove('active'))
  const page = document.getElementById('page-' + id)
  if (page) page.classList.add('active')
  if (el) el.classList.add('active')
  const t = PAGE_TITLES[id]
  if (t) {
    const titleEl = document.getElementById('main-page-title')
    const subEl   = document.getElementById('main-page-sub')
    if (titleEl) titleEl.textContent = t[0]
    if (subEl)   subEl.textContent   = t[1]
  }
  if (id === 'dashboard') renderDashboard()
  if (id === 'calendar')  renderCalendar()
  if (id === 'log')       { populateLogFilters(); renderLog() }
  if (id === 'settings')  populateSettingsFields()
  document.getElementById('settings-tip').style.display = id === 'settings' ? 'block' : 'none'
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 2500)
}

// ── Sync status ───────────────────────────────────────────────────────────────
function setSyncStatus(msg, type) {
  const el = document.getElementById('sync-status')
  if (!el) return
  el.textContent = msg
  el.style.color = type === 'error' ? 'var(--red)' : type === 'ok' ? 'var(--accent)' : 'var(--muted2)'
}

// ── Sidebar data range ────────────────────────────────────────────────────────
function updateSidebarInfo() {
  const el = document.getElementById('sidebar-data-range')
  if (!el) return
  if (!state.rows.length) { el.innerHTML = ''; return }
  const dates = state.rows.map((r) => r.closeDate).filter(Boolean).sort()
  el.innerHTML = `<div class="sdr-label">synced data range</div><div class="sdr-val">${dates[0]} → ${dates[dates.length - 1]}</div>`
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function populateSettingsFields() {
  const { account_id, token } = await loadCredentials()
  const aid = document.getElementById('s-account-id')
  const tok = document.getElementById('s-token')
  if (aid) aid.value = account_id || ''
  if (tok) tok.value = token      || ''

  const { total, last_sync, date_from, date_to } = await loadTradesMeta()
  const syncInfo = document.getElementById('sync-info')
  if (!syncInfo) return
  if (!total) { syncInfo.innerHTML = ''; return }
  const t     = last_sync ? new Date(last_sync).toLocaleString() : '—'
  const range = date_from ? `${date_from} → ${date_to}` : '—'
  syncInfo.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px;">
      <div><span style="color:var(--muted);">Last synced:</span> ${t}</div>
      <div><span style="color:var(--muted);">Data:</span> ${total.toLocaleString()} legs, from ${range}</div>
    </div>`
}

function toggleFieldVisibility(fieldId, btnId) {
  const inp = document.getElementById(fieldId)
  const btn = document.getElementById(btnId)
  if (inp.type === 'password') { inp.type = 'text';     btn.textContent = '🙈' }
  else                         { inp.type = 'password'; btn.textContent = '👁' }
}

// ── Sync ──────────────────────────────────────────────────────────────────────
async function syncFromTradier(account_id, token, silent = false) {
  try {
    const result = await syncWithBroker(account_id, token)

    if (result.error) {
      let msg = result.error
      if (msg.includes('403') || msg.includes('Forbidden'))
        msg = 'Invalid API token — check your credentials in Settings'
      else if (msg.includes('401') || msg.includes('Unauthorized'))
        msg = 'Unauthorized — your API token may have expired'
      else if (msg.includes('404') || msg.includes('Not found'))
        msg = 'Account ID not found — double-check your Account ID'
      throw new Error(msg)
    }

    const { trades } = await loadTradesFromDisk()
    state.rows = trades
    const activePage = document.querySelector('.page.active')?.id?.replace('page-', '')
    if (activePage) showPage(activePage, document.querySelector('nav a.active') || null)
    else renderDashboard()

    const ts      = result.last_sync ? new Date(result.last_sync).toLocaleTimeString() : ''
    const pageInfo = `${result.pages_fetched}/${result.total_pages ?? '?'} pages`
    setSyncStatus(`✓ Synced at ${ts} — ${result.added} new, ${result.total} total (${pageInfo})`, 'ok')
    if (silent && result.added > 0) showToast(`Synced — ${result.added} new positions`)

    populateSettingsFields()
    updateSidebarInfo()
    return result
  } catch (err) {
    setSyncStatus('✗ ' + err.message, 'error')
    if (silent) console.warn('Sync failed:', err.message)
  }
}

async function saveTradierCreds() {
  const account = document.getElementById('s-account-id').value.trim()
  const token   = document.getElementById('s-token').value.trim()
  if (!account || !token) { setSyncStatus('Enter both Account ID and token.', 'error'); return }
  await saveCredentials(account, token)
  setSyncStatus('Saved. Syncing…', 'info')
  await syncFromTradier(account, token)
}

async function triggerSync() {
  const { account_id, token } = await loadCredentials()
  if (!account_id || !token) {
    const nav = [...document.querySelectorAll('nav a')].find((a) => a.textContent.trim() === 'Settings')
    if (nav) showPage('settings', nav)
    showToast('Enter Tradier credentials in Settings first')
    return
  }
  document.getElementById('refresh-btn').classList.add('spinning')
  await syncFromTradier(account_id, token, true)
  document.getElementById('refresh-btn').classList.remove('spinning')
}

// ── Clear actions ─────────────────────────────────────────────────────────────
async function clearTradeLogs() {
  if (!confirm('Clear all synced trade logs? Your credentials stay saved. You can re-sync immediately after.')) return
  await clearTradeLogsAPI()
  state.rows = []
  updateSidebarInfo()
  const syncInfo = document.getElementById('sync-info')
  if (syncInfo) syncInfo.innerHTML = ''
  setSyncStatus('Trade logs cleared — hit Sync Trades to re-pull.', 'info')
  renderDashboard()
}

async function clearAllData() {
  if (!confirm('Clear ALL data including credentials and trade logs? You will need to re-enter your Account ID and API token.')) return
  await clearAllAPI()
  state.rows = []
  document.getElementById('s-account-id').value = ''
  document.getElementById('s-token').value       = ''
  updateSidebarInfo()
  const syncInfo = document.getElementById('sync-info')
  if (syncInfo) syncInfo.innerHTML = ''
  setSyncStatus('All data and credentials cleared.', 'info')
  renderDashboard()
}

// ── CSV import ────────────────────────────────────────────────────────────────
async function handleCSVImport(input) {
  const file = input.files[0]
  if (!file) return
  document.getElementById('csv-file-name').textContent = file.name
  const setCsvStatus = (msg, type) => {
    const el = document.getElementById('csv-status')
    if (!el) return
    el.textContent = msg
    el.style.color = type === 'error' ? 'var(--red)' : type === 'ok' ? 'var(--accent)' : 'var(--muted2)'
  }
  setCsvStatus('Reading file…', 'info')
  try {
    const text = await file.text()
    let rows
    try { rows = parseTradierCSV(text) }
    catch (e) { setCsvStatus('✗ ' + e.message, 'error'); return }
    if (!rows.length) { setCsvStatus('✗ No valid rows found in CSV', 'error'); return }
    setCsvStatus(`Parsed ${rows.length} rows — importing…`, 'info')

    const result = await importTradesAPI(rows)
    if (result.error) { setCsvStatus('✗ ' + result.error, 'error'); return }

    const { trades } = await loadTradesFromDisk()
    state.rows = trades
    updateSidebarInfo()
    populateSettingsFields()
    const activePage = document.querySelector('.page.active')?.id?.replace('page-', '')
    if (activePage) showPage(activePage, document.querySelector('nav a.active') || null)
    else renderDashboard()

    setCsvStatus(`✓ Imported — ${result.added} new rows added, ${result.total} total positions`, 'ok')
    input.value = ''
  } catch (e) {
    const el = document.getElementById('csv-status')
    if (el) { el.textContent = '✗ ' + (e.message || 'Import failed'); el.style.color = 'var(--red)' }
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function toggleTheme() {
  const current = localStorage.getItem('gg-theme') || 'dark'
  const next    = current === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  const activePage = document.querySelector('.page.active')?.id?.replace('page-', '')
  if (activePage === 'dashboard') renderDashboard()
}

// ── Startup ───────────────────────────────────────────────────────────────────
async function autoSync() {
  const { trades, last_sync } = await loadTradesFromDisk()
  if (trades?.length) {
    state.rows = trades
    console.log(`Loaded ${trades.length} trades from disk (last sync: ${last_sync})`)
  }
  updateSidebarInfo()

  const series = allSeries()
  if (series.length) {
    const lastDate  = series[series.length - 1].date
    state.calYear   = parseInt(lastDate.slice(0, 4))
    state.calMonth  = parseInt(lastDate.slice(5, 7)) - 1
  }

  renderDashboard()
  await loadCredentials()
}

// ── Copy chart panel as image ─────────────────────────────────────────────────
async function copyChartPanel(canvasId) {
  const btn = document.getElementById(canvasId).closest('.panel').querySelector('.cal-share-btn')
  const origContent = btn.innerHTML
  btn.disabled = true
  btn.innerHTML = '…'
  try {
    const panel = document.getElementById(canvasId).closest('.panel')
    const canvas = await html2canvas(panel, { backgroundColor: null, scale: 2, useCORS: true })
    canvas.toBlob(async (blob) => {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      btn.innerHTML = '✓'
      setTimeout(() => { btn.innerHTML = origContent; btn.disabled = false }, 2000)
    })
  } catch {
    btn.innerHTML = '!'
    setTimeout(() => { btn.innerHTML = origContent; btn.disabled = false }, 2000)
  }
}

// ── Share calendar as image ───────────────────────────────────────────────────
async function shareCalendar() {
  const btn = document.getElementById('cal-share-btn')
  btn.textContent = 'Capturing…'
  btn.disabled = true
  try {
    const panel = document.querySelector('#page-calendar .panel')
    const canvas = await html2canvas(panel, { backgroundColor: null, scale: 2, useCORS: true })
    canvas.toBlob(async (blob) => {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      btn.textContent = 'Copied!'
      setTimeout(() => { btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg> Copy Image'; btn.disabled = false }, 2000)
    })
  } catch (e) {
    btn.textContent = 'Failed'
    setTimeout(() => { btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg> Copy Image'; btn.disabled = false }, 2000)
  }
}

// ── Expose to window for HTML inline handlers ─────────────────────────────────
Object.assign(window, {
  showPage, calNav, openDayModal, closeModal, triggerSync, toggleTheme,
  setLogView, clearLogDates, toggleFieldVisibility,
  saveTradierCreds, clearTradeLogs, clearAllData, handleCSVImport, shareCalendar, copyChartPanel,
})

// ── Init ──────────────────────────────────────────────────────────────────────
applyTheme(localStorage.getItem('gg-theme') || 'dark')
autoSync()
