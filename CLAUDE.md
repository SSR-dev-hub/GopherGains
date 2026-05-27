# GopherGains — Claude Context

> Native Electron desktop trading journal for Tradier spreads traders. Double-click to launch from Dock — no terminal, no browser tab.

---

## What this app does

Pulls closed position (gain/loss) data from the Tradier brokerage API and visualises it as a spreads trading journal. Key insight: Tradier returns individual option **legs**, not grouped spreads. The app intelligently groups legs into Put Spreads, Call Spreads, and Iron Condors by matching underlying + expiry + option type.

---

## File structure

```
zeroday/
├── package.json                  ← App manifest, npm scripts, electron-builder config
├── src/                          ← Electron main process (Node.js)
│   ├── main.js                   ← BrowserWindow creation + app lifecycle
│   ├── preload.js                ← contextBridge: exposes electronAPI to renderer
│   └── lib/
│       ├── ipc.js                ← All ipcMain.handle() registrations
│       ├── store.js              ← File I/O — trades.json + config.json
│       ├── dedup.js              ← Merge-dedup algorithm (preserves legitimate duplicate fills)
│       └── broker/
│           ├── index.js          ← Active broker re-export (swap here to add brokers)
│           └── tradier.js        ← Tradier API — paginated incremental sync
├── app/
│   └── frontend/
│       ├── index.html            ← HTML structure only (no inline styles or scripts)
│       ├── css/
│       │   └── styles.css        ← All styles + CSS custom properties
│       └── js/                   ← ES modules (type="module")
│           ├── state.js          ← Shared mutable state (rows, calYear, calMonth, logView)
│           ├── constants.js      ← THEMES, TICKER_ALIASES, TYPE labels
│           ├── utils.js          ← Pure helpers (fmt, getUnderlying, allSeries…)
│           ├── spreads.js        ← Spread grouping + trade card builders
│           ├── charts.js         ← Chart.js config + applyTheme
│           ├── api.js            ← IPC / HTTP backend bridge
│           ├── render.js         ← Page renderers (dashboard, calendar, log, underlying)
│           └── app.js            ← Entry point — init, nav, event handlers
├── build/
│   ├── gopher-chart.png          ← App icon source image
│   ├── setup-icon.sh             ← Generates build/icons/ (icns + ico + png)
│   └── icons/                    ← Generated (gitignored)
│       ├── icon.icns             ← macOS
│       ├── icon.ico              ← Windows
│       └── icon.png              ← 512×512 fallback
└── dist/                         ← electron-builder output (gitignored)
```

---

## Architecture

### Runtime

```
npm start → Electron → BrowserWindow → app/frontend/index.html
                ↓
           src/main.js (Node.js main process)
                ↓
           src/lib/ipc.js (ipcMain handlers)
                ↓
           src/lib/store.js + src/lib/broker/tradier.js
```

Data stored at `~/.gophergains/trades.json` and `~/.gophergains/config.json` — same paths as the old Python server so existing user data migrates automatically.

### IPC channel map

All renderer→main communication via `window.electronAPI.invoke(channel, args)`.

| Channel | Args | Response |
|---|---|---|
| `trades:load` | `{}` | `{ trades, total, last_sync, date_from, date_to }` |
| `trades:sync` | `{ account_id, token }` | `SyncResult` or `{ error }` |
| `trades:import` | `{ rows }` | `{ added, total, last_sync }` |
| `trades:clearLogs` | `{}` | `{ ok: true }` |
| `trades:clearAll` | `{}` | `{ ok: true }` |
| `config:load` | `{}` | `{ account_id, token }` |
| `config:save` | `{ account_id, token }` | `{ ok: true }` |
| `app:version` | `{}` | `{ version }` |

### Data flow

```
Tradier API → broker/tradier.js → store.js → ~/.gophergains/trades.json
                                                      ↓
                                              IPC trades:load
                                                      ↓
                                              state.rows (ES module)
                                                      ↓
                                    allRows() → groupIntoSpreads() → UI
```

### Frontend module dependency graph

```
app.js
  ├── state.js
  ├── utils.js       ← state.js
  ├── spreads.js     ← utils.js, constants.js
  ├── charts.js      ← constants.js
  ├── render.js      ← state.js, utils.js, spreads.js, charts.js, constants.js
  └── api.js         (no imports from render/charts — pure IPC bridge)
```

**Key**: `app.js` calls `applyTheme` (from charts.js) then re-renders the active page — this avoids a circular dependency between render.js and charts.js.

### ES modules + HTML inline handlers

`index.html` uses `<script type="module" src="js/app.js">` — ES modules don't expose functions to global scope. Functions needed by HTML `onclick` attributes are explicitly exported via `Object.assign(window, {...})` at the bottom of `app.js`.

---

## The spread grouping logic (most important)

Tradier returns raw option legs. The app groups them into logical spreads.

### Key functions in `app/frontend/js/spreads.js`

**`parseSymbol(row)`** — parses a Tradier symbol like `NDXP260520P28410000`:
- Extracts: ticker (`NDX`), option type (`P`/`C`), expiry (`260520`), strike (`28410`)
- Strike parsing: raw integer / 1000 if >= 1,000,000 (NDX style), otherwise as-is (QQQ style)

**`groupIntoSpreads(dayRows)`** — groups legs into spreads:
- Buckets by `ticker|expiry`
- If bucket has BOTH P and C legs → **Iron Condor**
- If only P legs → **Put Spread**
- If only C legs → **Call Spread**
- Qty calculation:
  - Put/Call Spread: `sum(abs(quantity) for short legs)`
  - Iron Condor: `min(p_short_total, c_short_total)` — one of each per IC contract

**`buildBatches(pRaw, cRaw)`** — detects partial fills within a spread:
- Groups legs by `abs(quantity)` — same qty = same fill order
- Calculates `netPerContract = sum(gainLoss) / qty` (uses broker P&L, not reconstructed from cost/proceeds — important for multi-day trades)
- Returns array of `{qty, netPerContract, pnl, pShortStr, pLongStr, cShortStr, cLongStr}`

**`prettyExpiry(raw)`** — converts `260520` → `20 May '26`

### Ticker mapping (in `constants.js`)

```js
TICKER_ALIASES = { SPXW:'SPX', NDXP:'NDX', DJXW:'DJX', RUTW:'RUT', NQXP:'NQX' }
```

---

## Data model

### Internal row format (what `state.rows` contains)

```js
{
  symbol:      "NDXP260520P28410000",
  quantity:    -5,           // negative = short, positive = long
  cost:        0,            // opening cost (may be non-zero for closing trades)
  proceeds:    -2448.77,     // negative proceeds = credit received
  gainLoss:    2448.77,      // broker-computed P&L (source of truth)
  gainLossPct: 0,
  closeDate:   "2026-05-20",
  term:        0,            // 0=short, 1=long term
  source:      "tradier"     // or "csv" for CSV imports
}
```

### Tradier API response → internal mapping

```js
gainLoss    ← p.gain_loss
gainLossPct ← p.gain_loss_percent
closeDate   ← p.close_date.slice(0, 10)
// everything else: snake_case → camelCase
```

---

## Smart incremental sync (`src/lib/broker/tradier.js`)

When user hits sync:
1. Load existing trades from disk, find `latestDate`
2. Set `cutoff = latestDate - 7 days` (overlap buffer for late-settling trades)
3. Fetch Tradier pages newest-first, stop when `closeDate < cutoff` OR partial page
4. Keep all existing rows before cutoff, replace everything after with fresh data
5. Deduplicate via `mergeDedup` (preserves max-count copies per unique key)
6. Save merged result

A daily sync typically fetches 1-2 pages instead of all pages.

### Dedup algorithm (`src/lib/dedup.js`)

`tradeKey` = `JSON.stringify([symbol, closeDate, quantity, cost, gainLoss])`

`mergeDedup(existing, incoming)` — for each key, keep whichever set (existing or incoming) has more copies. Ties go to existing. This preserves legitimate duplicate fills at the same price that real brokers generate.

---

## UI structure

### Pages (single-page app, shown/hidden via JS)

| Page ID | Nav label | Key function |
|---|---|---|
| `page-dashboard` | Dashboard | `renderDashboard()` |
| `page-calendar` | Calendar | `renderCalendar()` |
| `page-log` | Trade Log | `renderLog()` |
| `page-underlying` | By Underlying | `renderUnderlying()` |
| `page-settings` | Settings | `populateSettingsFields()` |

### CSS variables (design tokens) — `app/frontend/css/styles.css`

```css
--bg: #0a0c0f          /* page background */
--surface: #111318     /* card background */
--surface2: #181c23    /* input/row background */
--border: #1e2330      /* default border */
--border2: #252c3d     /* hover border */
--text: #e8eaf0        /* primary text */
--muted: #5a6070       /* secondary text */
--muted2: #7a8090      /* tertiary text */
--accent: #4ade80      /* green — wins, positive */
--red: #f87171         /* red — losses, negative */
--blue: #60a5fa        /* call options */
--yellow: #fbbf24      /* put options */
--font-display: 'Syne'
--font-mono: 'DM Mono'
```

### Shared state (`app/frontend/js/state.js`)

```js
export const state = {
  rows: [],          // all loaded trade rows (replaces window._tradierRows)
  calYear: ...,      // currently displayed calendar year
  calMonth: ...,     // currently displayed calendar month (0-indexed)
  logView: 'trades', // 'trades' | 'legs'
}
```

### Startup sequence (`app.js`)

```js
applyTheme(localStorage.getItem('zd-theme') || 'dark')
autoSync()
  → loadTradesFromDisk()         // IPC trades:load
  → state.rows = trades
  → set calYear/calMonth from most recent trade date
  → renderDashboard()
  → loadCredentials()
```

---

## Calendar

- Tradezella-style monthly grid
- Each day cell: green/red background, P&L total, spread chips
- Spread chip format: `TICKER [PS/CS/IC] ×qty +$pnl`
- Max 4 chips per cell, overflow shows `+N` badge
- Click any day → modal with spread cards and fill details
- Weekly rollup column on right
- Month header shows: total P&L, trading days, win rate

---

## Trade Log

Two views toggled by `Trades` / `Legs` buttons:
- **Trades view**: grouped by date, each spread as a dense single row
  - Format: `TICKER | PS/CS/IC | ×qty | strikes | [fill chips] | P&L`
  - Fill chips: `×qty $net/c $pnl` per partial fill
- **Legs view**: raw table of individual option legs

---

## Known issues / watch out for

1. **`netPerContract` must use `gainLoss / qty`**, NOT `(proceeds - cost) / qty`. The cost field carries the opening price for multi-day trades — reconstructing from it gives wrong results.

2. **Iron Condor qty** = `min(p_shorts, c_shorts)`, NOT sum. Each IC uses one put spread + one call spread, so doubling the count is wrong.

3. **`autoSync()` must be awaited** before `renderDashboard()` — charts will be empty if trades haven't loaded from disk yet. The async sequence matters.

4. **Strike parsing edge cases**: QQQ strikes come as small integers (681, 685), NDX strikes come as large integers (28970000 → 28970). Both must divide by 1000 if >= 1,000,000.

5. **`classList` null guard**: `showPage(id, el)` must handle `el = null` gracefully — the active nav element can be null when re-rendering after a background sync.

6. **Chart.js as CDN global in ES modules**: `render.js` and `charts.js` reference `Chart` directly. This works because Chart.js loads via `<script>` tag before the module. The `/* global Chart */` comment is a lint annotation, not a runtime fix.

7. **`window.*` exposure**: ES module functions needed by HTML `onclick` attributes are exposed via `Object.assign(window, {...})` in `app.js`. If you add a new inline handler in `index.html`, add the function to that assignment.

---

## Tradier API notes

- Base URL: `https://api.tradier.com/v1`
- Auth: `Bearer {token}` header
- Gain/loss endpoint: `GET /accounts/{account_id}/gainloss`
- Params: `page`, `limit` (max 100), `sortBy=closeDate`, `sort=desc`
- Response: `data.gainloss.closed_position` (array, or dict if single result — normalise to array)
- `total_pages` in response for pagination
- Token location: Tradier → Preferences → API Access → **Brokerage** (not Sandbox)
- 403 = wrong token, 404 = wrong account ID

---

## Development workflow

**Run locally:**
```bash
npm install          # one time
npm start            # launches Electron window
npm run dev          # same + DevTools open, Cmd+R reloads renderer
```

**Build distributables:**
```bash
./build/setup-icon.sh   # generate build/icons/ (one time, macOS only)
npm run dist:mac         # → dist/GopherGains-1.0.0.dmg (universal arm64+x64)
npm run dist:win         # → dist/GopherGains Setup 1.0.0.exe
```

**Add a new broker:**
1. Create `src/lib/broker/newbroker.js` exporting `{ syncTrades(accountId, token, existing) }`
2. Change `src/lib/broker/index.js` to `module.exports = require('./newbroker')`
3. No other files need to change

**Test main-process modules standalone:**
```bash
node -e "const s = require('./src/lib/store'); console.log(s.loadTrades().length, 'trades')"
node -e "require('./src/lib/dedup').mergeDedup([{symbol:'X',closeDate:'2026-01-01',quantity:-1,cost:0,gainLoss:100}], []).length"
```

---

## README maintenance

After completing any significant feature, **always consult the user before touching README.md**. Do not update it silently.

When a big feature lands, propose README changes by listing what could be added — new feature bullets, updated quickstart steps, data & privacy notes, etc. — and let the user decide what to include. Only edit the file after explicit approval.

What counts as a significant feature: new UI page or major UI overhaul, new data source or sync behaviour, new settings/config options, security-relevant changes (encryption, credential handling), new build or release steps.

---

## What's NOT implemented yet

- [ ] Notes/journal per trade day
- [ ] P&L as % of account (would need account balance from Tradier)
- [ ] Export to CSV
- [ ] Mobile responsive layout
