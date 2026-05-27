# GopherGains

> A native desktop trading journal for Tradier spreads(can also work for other trades) traders. Pulls your full gain/loss history directly from the Tradier API — no manual entry, no spreadsheets, no browser tab.

## Download

Pre-built installers for macOS and Windows are available on the [Releases page](../../releases/latest).

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `GopherGains-x.x.x-arm64.dmg` |
| macOS (Intel) | `GopherGains-x.x.x.dmg` |
| Windows | `GopherGains Setup x.x.x.exe` |

> **macOS note:** Because the app is not yet notarized, Gatekeeper may show _"damaged and can't be opened."_ Run this once in Terminal after installing:
> ```bash
> sudo xattr -r -d com.apple.quarantine /Applications/GopherGains.app
> ```
> On Windows, SmartScreen may warn on first launch — click **More info → Run anyway**.

If GopherGains is useful to you, please consider starring the repo.

If it genuinely made a difference to your trading, [a small donation via Venmo](https://venmo.com/u/ssr-7) is always appreciated.

---

## Features

- **Native Electron app** — double-click to launch, lives in your Dock like any macOS app
- **Equity curve & drawdown** — full P&L history visualised
- **Tradezella-style calendar** — daily P&L grid, click any day to drill into individual spreads
- **Smart spread grouping** — auto-detects Put Spreads, Call Spreads and Iron Condors from raw option legs
- **Stocks & single-leg options** — handles equities and non-spread positions alongside spreads
- **Trade log** — dense, filterable rows grouped by date with date-range and win/loss filters
- **By Underlying** — P&L breakdown and equity curve across NDX, QQQ, SPX, SPY, and more
- **Monthly bar chart** — trade count + win rate on hover, best month labelled
- **Auto-sync on launch** — trades refresh automatically every time you open the app (no manual sync needed)
- **Tentative today P&L** — shows intraday P&L on the calendar from live orders, marked as unsettled and excluded from all stats
- **Dark / Light theme** — persisted across restarts
- **CSV import** — import Tradier gain/loss CSV exports and merge with existing data
- **Win streak** — current and all-time best
- **Encrypted local storage** — credentials and trade data encrypted via OS keychain, never readable on another machine

---

## Quickstart

### Prerequisites

- [Node.js 20+](https://nodejs.org) — one-time install

### Running from source

```bash
# 1. Install dependencies (one time)
npm install

# 2. Generate app icons (one time, macOS only)
./build/setup-icon.sh

# 3. Launch the app
npm start

# Dev mode (DevTools open, Cmd+R to reload)
npm run dev
```

### Building a distributable

```bash
# macOS (.dmg — universal arm64 + x64)
npm run dist:mac

# Windows (.exe installer)
npm run dist:win
```

The `.dmg` / `.exe` will appear in `dist/`. Drag GopherGains to Applications on macOS, or run the installer on Windows.

---

## Getting your Tradier API token

1. Log into [tradier.com](https://tradier.com)
2. **Preferences → API Access**
3. Copy your **Production Brokerage Access Token** (not Sandbox)

In GopherGains, open **Settings**, enter your Account ID and token, and hit **Save & Sync Now**.

---

## Data & privacy

- Credentials and trade history are stored locally at `~/.gophergains/` — never leaves your machine
- Both files are **encrypted at rest** using your OS credential store (macOS Keychain / Windows DPAPI) — unreadable on any other machine even if the files are copied
- All API calls go directly to `api.tradier.com` — no third parties, no telemetry
- API sync is optional — you can import a CSV exported from Tradier instead

---

## Project structure

```
zeroday/
├── package.json                  ← App manifest, scripts, electron-builder config
├── src/                          ← Electron main process
│   ├── main.js                   ← BrowserWindow creation + app lifecycle
│   ├── preload.js                ← Secure contextBridge (IPC bridge to renderer)
│   └── lib/
│       ├── ipc.js                ← All IPC channel handlers
│       ├── store.js              ← File I/O — trades.json + config.json
│       ├── dedup.js              ← Merge-dedup algorithm (preserves legitimate fills)
│       └── broker/
│           ├── index.js          ← Active broker export (swap here to add brokers)
│           └── tradier.js        ← Tradier API — paginated incremental sync
├── app/
│   └── frontend/
│       ├── index.html            ← HTML structure
│       ├── css/
│       │   └── styles.css        ← All styles + CSS custom properties
│       └── js/                   ← ES modules
│           ├── app.js            ← Entry point — init, nav, event handlers
│           ├── api.js            ← IPC / HTTP backend bridge
│           ├── render.js         ← Page renderers (dashboard, calendar, log)
│           ├── spreads.js        ← Spread grouping + trade card builders
│           ├── charts.js         ← Chart.js config + theme management
│           ├── utils.js          ← Pure helpers (fmt, getUnderlying, allSeries…)
│           ├── constants.js      ← Static lookup tables + theme tokens
│           └── state.js          ← Shared mutable app state
└── build/
    ├── gopher-chart.png          ← App icon source image
    └── setup-icon.sh             ← Generates build/icons/ (icns + ico + png)
```

---

## Releases

### Publishing a new release (maintainers)

Bump the version in `package.json`, then tag and push:

```bash
git add package.json
git commit -m "chore: bump version to 1.x.x"
git tag v1.x.x
git push && git push origin v1.x.x
```

GitHub Actions builds both platforms automatically and publishes the installers to the Releases page. No manual build steps needed.

---

## Tech stack

| Layer | Tech |
|---|---|
| Desktop wrapper | [Electron](https://electronjs.org) — Chromium + Node.js |
| Charts | [Chart.js 4](https://chartjs.org) |
| Packaging | [electron-builder](https://electron.build) — DMG + NSIS |
| Data source | [Tradier Brokerage API](https://docs.tradier.com) |
| Frontend | Vanilla ES2020+, CSS custom properties, no frameworks |

---

## License

MIT
