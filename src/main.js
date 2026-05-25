'use strict'

const { app, BrowserWindow, Menu } = require('electron')
const path = require('path')
const { registerIpcHandlers } = require('./lib/ipc')

const isDev = process.argv.includes('--dev')
const isMac = process.platform === 'darwin'

function createWindow() {
  const win = new BrowserWindow({
    width:           1280,
    height:          820,
    minWidth:        900,
    minHeight:       600,
    backgroundColor: '#0a0c0f',
    titleBarStyle:   isMac ? 'hiddenInset' : 'default',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })

  win.loadFile(path.join(__dirname, '..', 'app', 'frontend', 'index.html'))

  if (isDev) {
    win.webContents.openDevTools()
    win.webContents.on('before-input-event', (_event, input) => {
      if ((input.meta || input.control) && input.key === 'r') win.reload()
    })
  }

  // Allow Chart.js CDN + Google Fonts in production
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' https://api.tradier.com",
        ],
      },
    })
  })

  return win
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

registerIpcHandlers()

app.whenReady().then(() => {
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
