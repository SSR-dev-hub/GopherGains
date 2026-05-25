/* global Chart */
import { state } from './state.js'
import { fmt, allRows, allSeries, getUnderlying, prettyExpiry } from './utils.js'
import { groupIntoSpreads, buildBatches, calChip, buildSpreadCard } from './spreads.js'
import { getChartCfg } from './charts.js'
import { THEMES, TYPE_BADGE_CLS, TYPE_FULL_LABEL, TICKER_CLS_MAP } from './constants.js'

let equityChart, drawdownChart, winLossChart, underlyingCountChart, underlyingLineChart, monthlyChart

export function renderDashboard() {
  const series = allSeries()

  const banner = document.getElementById('setup-banner')
  if (banner) banner.style.display = state.rows.length ? 'none' : 'flex'

  const totalPnl    = series.length ? series[series.length - 1].cumulative : 0
  const tradingDays = series.length
  const winDays     = series.filter((s) => s.daily > 0).length
  const lossDays    = series.filter((s) => s.daily < 0).length
  const winRate     = tradingDays ? (winDays / tradingDays * 100).toFixed(0) : 0
  const winAmts     = series.filter((s) => s.daily > 0).map((s) => s.daily)
  const lossAmts    = series.filter((s) => s.daily < 0).map((s) => s.daily)
  const avgWin      = winAmts.length  ? winAmts.reduce((a, b) => a + b, 0) / winAmts.length : 0
  const avgLoss     = lossAmts.length ? lossAmts.reduce((a, b) => a + b, 0) / lossAmts.length : 0
  const profitFactor = avgLoss ? Math.abs(avgWin * winAmts.length / (avgLoss * lossAmts.length)).toFixed(2) : '—'

  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date))
  let currentStreak = 0, longestStreak = 0, runStreak = 0
  for (const s of sorted) {
    if (s.daily > 0) { runStreak++; longestStreak = Math.max(longestStreak, runStreak) }
    else runStreak = 0
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].daily > 0) currentStreak++
    else break
  }

  document.getElementById('stat-cards').innerHTML = `
    <div class="stat"><div class="stat-label">Net P&L</div><div class="stat-val ${totalPnl >= 0 ? 'pos' : 'neg'}">${fmt(totalPnl)}</div><div class="stat-sub">${tradingDays} trading days</div></div>
    <div class="stat"><div class="stat-label">Win Rate</div><div class="stat-val">${winRate}%</div><div class="stat-sub">${winDays}W / ${lossDays}L</div></div>
    <div class="stat"><div class="stat-label">Profit Factor</div><div class="stat-val">${profitFactor}</div><div class="stat-sub">wins vs losses ratio</div></div>
    <div class="stat"><div class="stat-label">Avg Win Day</div><div class="stat-val pos">${fmt(avgWin)}</div><div class="stat-sub">avg loss ${fmt(avgLoss)}</div></div>
    <div class="stat"><div class="stat-label">Win Streak</div><div class="stat-val pos">${currentStreak}</div><div class="stat-sub">best ${longestStreak} days</div></div>
  `
  document.getElementById('equity-range').textContent = series.length
    ? `${series[0].date} → ${series[series.length - 1].date}` : ''

  const labels   = series.map((s) => s.date.slice(5))
  const cumuData = series.map((s) => s.cumulative)
  const theme    = localStorage.getItem('gg-theme') || 'dark'
  const t        = THEMES[theme] || THEMES.dark

  const gradCtx = document.getElementById('equityChart').getContext('2d')
  const grad    = gradCtx.createLinearGradient(0, 0, 0, 240)
  grad.addColorStop(0, 'rgba(74,222,128,0.25)')
  grad.addColorStop(1, 'rgba(74,222,128,0)')
  if (equityChart) equityChart.destroy()
  equityChart = new Chart(gradCtx, {
    type: 'line',
    data: { labels, datasets: [{ data: cumuData, borderColor: '#4ade80', borderWidth: 2, fill: true, backgroundColor: grad, pointRadius: 0, tension: 0.3 }] },
    options: { ...getChartCfg(), scales: { x: { display: true, grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } }, y: { display: true, grid: { color: t.chartGrid }, ticks: { callback: (v) => fmt(v, 0) } } } },
  })

  let peak = 0
  const dd = []
  cumuData.forEach((v) => { peak = Math.max(peak, v); dd.push(Math.min(0, v - peak)) })
  const maxDD = Math.min(...dd)
  document.getElementById('max-dd-label').textContent = `Max DD: ${fmt(maxDD, 0)}`
  const ddCtx  = document.getElementById('drawdownChart').getContext('2d')
  const ddGrad = ddCtx.createLinearGradient(0, 0, 0, 200)
  ddGrad.addColorStop(0, 'rgba(248,113,113,0.25)')
  ddGrad.addColorStop(1, 'rgba(248,113,113,0)')
  if (drawdownChart) drawdownChart.destroy()
  drawdownChart = new Chart(ddCtx, {
    type: 'line',
    data: { labels, datasets: [{ data: dd, borderColor: '#f87171', borderWidth: 1.5, fill: true, backgroundColor: ddGrad, pointRadius: 0, tension: 0.3 }] },
    options: { ...getChartCfg(), scales: { x: { display: false }, y: { display: true, grid: { color: t.chartGrid }, max: 0, ticks: { callback: (v) => fmt(v, 0) } } } },
  })

  if (winLossChart) winLossChart.destroy()
  winLossChart = new Chart(document.getElementById('winLossChart'), {
    type: 'doughnut',
    data: { labels: ['Win', 'Loss'], datasets: [{ data: [winDays, lossDays], backgroundColor: ['rgba(74,222,128,0.8)', 'rgba(248,113,113,0.6)'], borderColor: ['#4ade80', '#f87171'], borderWidth: 1 }] },
    options: { ...getChartCfg(), cutout: '72%', plugins: { ...getChartCfg().plugins, legend: { display: true, position: 'right', labels: { color: '#7a8090', font: { size: 11 } } } } },
  })

  document.getElementById('recent-days').innerHTML = [...series].slice(-8).reverse().map((s) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);">
      <span style="color:var(--muted2);font-size:11px;">${s.date}</span>
      <span class="${s.daily >= 0 ? 'pos' : 'neg'}" style="font-family:var(--font-display);font-size:13px;font-weight:700;">${fmt(s.daily)}</span>
      <span style="font-size:11px;color:var(--muted);">${fmt(s.cumulative, 0)}</span>
    </div>`).join('')

  renderMonthly()
  renderUnderlying()
}

export function renderCalendar() {
  const series       = allSeries()
  const rows         = allRows()
  const byDate       = {}
  const tradesByDate = {}
  series.forEach((s) => { byDate[s.date] = s.daily })
  rows.forEach((r) => { if (!tradesByDate[r.closeDate]) tradesByDate[r.closeDate] = []; tradesByDate[r.closeDate].push(r) })

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  document.getElementById('cal-month-label').textContent = `${monthNames[state.calMonth]} ${state.calYear}`

  const monthKey = `${state.calYear}-${String(state.calMonth + 1).padStart(2, '0')}`
  let monthTotal = 0, monthWin = 0, monthDays = 0
  Object.keys(byDate).filter((d) => d.startsWith(monthKey)).forEach((d) => {
    monthTotal += byDate[d]; monthDays++; if (byDate[d] > 0) monthWin++
  })
  document.getElementById('cal-month-stats').innerHTML = `
    <span class="${monthTotal >= 0 ? 'pos' : 'neg'}" style="font-family:var(--font-display);font-weight:700;">${fmt(monthTotal)}</span>
    <span style="color:var(--muted);">${monthDays} days</span>
    <span style="color:var(--muted);">${monthDays ? Math.round(monthWin / monthDays * 100) : 0}% WR</span>`

  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  document.getElementById('cal-headers').innerHTML = days.map((d) => `<div class="cal-day-header">${d}</div>`).join('')

  const firstDay    = new Date(state.calYear, state.calMonth, 1).getDay()
  const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate()
  const today       = new Date().toISOString().slice(0, 10)

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(`<div class="cal-day empty"></div>`)

  const weekSums = []
  let currentWeek = 0, weekDayCount = firstDay

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${state.calYear}-${String(state.calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const pnl     = byDate[dateStr]
    const dayRows = tradesByDate[dateStr] || []
    let cls = 'cal-day'
    if (pnl !== undefined) cls += pnl >= 0 ? ' has-trades pos' : ' has-trades neg'
    if (dateStr === today) cls += ' today'

    let innerHtml = `<div class="cal-day-top">
      <span class="cal-day-num">${d}</span>
      ${pnl !== undefined ? `<span class="cal-day-pnl ${pnl >= 0 ? 'pos' : 'neg'}">${fmt(pnl, 0)}</span>` : ''}
    </div>`

    if (dayRows.length > 0) {
      const spreads = groupIntoSpreads(dayRows)
      const shown   = spreads.slice(0, 4)
      const extra   = spreads.length - 4
      innerHtml += `<div class="cal-trades">
        ${shown.map((s) => calChip(s)).join('')}
        ${extra > 0 ? `<div class="cal-more">+${extra}</div>` : ''}
      </div>`
    }

    const onclick = pnl !== undefined ? `onclick="openDayModal('${dateStr}')"` : ''
    cells.push(`<div class="${cls}" ${onclick}>${innerHtml}</div>`)

    weekDayCount++
    if (!weekSums[currentWeek]) weekSums[currentWeek] = 0
    if (pnl !== undefined) weekSums[currentWeek] += pnl
    if (weekDayCount % 7 === 0) { currentWeek++; weekDayCount = 0 }
  }

  const remainder = cells.length % 7
  if (remainder > 0) {
    for (let i = 0; i < 7 - remainder; i++) cells.push(`<div class="cal-day empty"></div>`)
    if (!weekSums[currentWeek]) weekSums[currentWeek] = 0
  }

  document.getElementById('cal-body').innerHTML = cells.join('')
  document.getElementById('cal-weeks').innerHTML = weekSums.map((w, i) => `
    <div class="cal-week-cell">
      <div class="cal-week-label">WK ${i + 1}</div>
      <div class="cal-week-val ${w >= 0 ? 'pos' : 'neg'}">${fmt(w, 0)}</div>
    </div>`).join('')
}

export function calNav(dir) {
  state.calMonth += dir
  if (state.calMonth > 11) { state.calMonth = 0; state.calYear++ }
  if (state.calMonth < 0)  { state.calMonth = 11; state.calYear-- }
  renderCalendar()
}

export function openDayModal(dateStr) {
  const rows  = allRows().filter((r) => r.closeDate === dateStr)
  const total = rows.reduce((a, b) => a + (parseFloat(b.gainLoss) || 0), 0)
  document.getElementById('modal-date-title').textContent = dateStr
  document.getElementById('modal-day-total').innerHTML =
    `<span class="${total >= 0 ? 'pos' : 'neg'}">${fmt(total)}</span>`

  const spreads  = groupIntoSpreads(rows)
  const rawByKey = {}
  rows.forEach((r) => {
    const sym  = r.symbol || ''
    const tm   = sym.match(/\d{6}([PC])/)
    if (!tm) return
    const ticker = getUnderlying(sym)
    const em     = sym.match(/[A-Z]+(\d{6})[CP]/)
    const expiry = em ? em[1] : 'X'
    const key    = ticker + '|' + expiry
    if (!rawByKey[key]) rawByKey[key] = { P: [], C: [] }
    rawByKey[key][tm[1]].push(r)
  })

  document.getElementById('modal-trades').innerHTML = spreads.map((s) => {
    const tickerCls = TICKER_CLS_MAP[s.ticker] || 'other'
    const label     = TYPE_FULL_LABEL[s.optType] || s.optType
    const cls       = TYPE_BADGE_CLS[s.optType]  || ''
    const key       = s.ticker + '|' + s.expiry
    const raw       = rawByKey[key] || { P: [], C: [] }
    const expStr    = s.expiry ? prettyExpiry(s.expiry) : ''
    const batches   = s.optType === 'STOCK' ? [] : buildBatches(raw.P, raw.C)
    const b0        = batches[0] || {}

    let strikeDefHtml = ''
    if (s.optType === 'IC') {
      const pWing = [b0.pShortStr, b0.pLongStr].filter(Boolean).join('/')
      const cWing = [b0.cShortStr, b0.cLongStr].filter(Boolean).join('/')
      strikeDefHtml = `<div class="modal-strike-def">
        <span class="modal-strike-wing put">P ${pWing}</span>
        <span class="modal-wing-sep">↔</span>
        <span class="modal-strike-wing call">C ${cWing}</span>
      </div>`
    } else if (s.optType === 'PS') {
      strikeDefHtml = `<div class="modal-strike-def"><span class="modal-strike-wing put">${b0.pShortStr}/${b0.pLongStr}</span></div>`
    } else if (s.optType === 'CS') {
      strikeDefHtml = `<div class="modal-strike-def"><span class="modal-strike-wing call">${b0.cShortStr}/${b0.cLongStr}</span></div>`
    } else if (s.optType === 'P') {
      const strike = b0.pShortStr || b0.pLongStr
      if (strike) strikeDefHtml = `<div class="modal-strike-def"><span class="modal-strike-wing put">${strike}</span></div>`
    } else if (s.optType === 'C') {
      const strike = b0.cShortStr || b0.cLongStr
      if (strike) strikeDefHtml = `<div class="modal-strike-def"><span class="modal-strike-wing call">${strike}</span></div>`
    }

    let batchRows = ''
    if (s.optType === 'STOCK') {
      const pnlStr = (s.pnl >= 0 ? '+$' : '-$') + Math.abs(Math.round(s.pnl))
      batchRows = `<div class="modal-batch-row">
        <span class="modal-batch-qty">×${s.qty} shares</span>
        <span class="modal-batch-pnl ${s.pnl >= 0 ? 'pos' : 'neg'}">${pnlStr}</span>
      </div>`
    } else {
      batchRows = batches.map((b) => {
        const net    = b.netPerContract
        const netStr = (net >= 0 ? '+$' : '-$') + Math.abs(net).toFixed(2)
        const pnlStr = (b.pnl >= 0 ? '+$' : '-$') + Math.abs(Math.round(b.pnl))
        return `<div class="modal-batch-row">
          <span class="modal-batch-qty">×${b.qty}</span>
          <span class="modal-batch-credit">${netStr}/c</span>
          <span class="modal-batch-pnl ${b.pnl >= 0 ? 'pos' : 'neg'}">${pnlStr}</span>
        </div>`
      }).join('')
    }

    const fillNote = batches.length > 1
      ? `<span style="font-size:10px;color:var(--muted2);">${batches.length} fills</span>` : ''
    const meta = [s.qty ? `×${s.qty}` : '', expStr].filter(Boolean).join(' · ')

    return `<div class="modal-spread-card">
      <div class="modal-spread-header">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="cal-chip-ticker ${tickerCls}" style="font-family:var(--font-display);font-weight:800;font-size:15px;">${s.ticker}</span>
          ${cls ? `<span class="badge ${cls}">${label}</span>` : ''}
          <span style="font-size:10px;color:var(--muted);">${meta}</span>
          ${fillNote}
        </div>
        <span class="${s.pnl >= 0 ? 'pos' : 'neg'}" style="font-family:var(--font-display);font-size:20px;font-weight:800;">${s.pnl >= 0 ? '+' : ''}${fmt(s.pnl, 0)}</span>
      </div>
      ${strikeDefHtml}
      <div class="modal-batches">${batchRows}</div>
    </div>`
  }).join('')

  document.getElementById('modal-overlay').classList.add('open')
}

export function closeModal(e) {
  if (e.target.id === 'modal-overlay') document.getElementById('modal-overlay').classList.remove('open')
}

export function renderLog() {
  const search     = document.getElementById('log-search').value.toLowerCase()
  const underlying = document.getElementById('log-underlying').value
  const result     = document.getElementById('log-result').value
  const dateFrom   = document.getElementById('log-date-from').value
  const dateTo     = document.getElementById('log-date-to').value

  let rows = allRows().filter((r) => {
    if (search && !r.symbol?.toLowerCase().includes(search)) return false
    if (underlying && getUnderlying(r.symbol || '') !== underlying) return false
    if (dateFrom && r.closeDate < dateFrom) return false
    if (dateTo   && r.closeDate > dateTo)   return false
    return true
  }).sort((a, b) => b.closeDate.localeCompare(a.closeDate))

  if (state.logView === 'trades') {
    const byDate = {}
    rows.forEach((r) => { if (!byDate[r.closeDate]) byDate[r.closeDate] = []; byDate[r.closeDate].push(r) })
    const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))
    let totalSpreads = 0

    const html = dates.map((date) => {
      const dayRows  = byDate[date]
      const rawByKey = {}
      dayRows.forEach((r) => {
        const sym  = r.symbol || ''
        const tm   = sym.match(/\d{6}([PC])/)
        if (!tm) return
        const ticker = getUnderlying(sym)
        const em     = sym.match(/[A-Z]+(\d{6})[CP]/)
        const exp    = em ? em[1] : 'X'
        const key    = ticker + '|' + exp
        if (!rawByKey[key]) rawByKey[key] = { P: [], C: [] }
        rawByKey[key][tm[1]].push(r)
      })

      const spreads = groupIntoSpreads(dayRows).filter((s) => {
        if (result === 'win'  && s.pnl <= 0) return false
        if (result === 'loss' && s.pnl >= 0) return false
        return true
      })
      if (!spreads.length) return ''
      totalSpreads += spreads.length
      const dayTotal = spreads.reduce((a, s) => a + s.pnl, 0)
      return `<div class="log-date-group">
        <div class="log-date-header">
          <span class="log-date-label">${date}</span>
          <span class="log-date-total ${dayTotal >= 0 ? 'pos' : 'neg'}">${dayTotal >= 0 ? '+$' : '-$'}${Math.abs(Math.round(dayTotal))}</span>
        </div>
        <div class="lc-table">${spreads.map((s) => buildSpreadCard(s, rawByKey)).join('')}</div>
      </div>`
    }).join('')

    document.getElementById('log-trades-view').innerHTML = html || '<div class="empty-state">No trades match filters</div>'
    document.getElementById('log-count').textContent = `${totalSpreads} trades across ${dates.filter((d) => byDate[d]).length} days`
  } else {
    if (result === 'win')  rows = rows.filter((r) => r.gainLoss > 0)
    if (result === 'loss') rows = rows.filter((r) => r.gainLoss < 0)
    document.getElementById('log-body').innerHTML = rows.map((r) => `
      <tr>
        <td style="color:var(--muted)">${r.closeDate}</td>
        <td style="font-size:11px;">${r.symbol || '—'}</td>
        <td>${r.quantity}</td>
        <td>${fmt(r.cost)}</td>
        <td>${r.proceeds ? fmt(Math.abs(r.proceeds)) : '—'}</td>
        <td><span class="${r.gainLoss >= 0 ? 'pos' : 'neg'}">${fmt(r.gainLoss)}</span></td>
      </tr>`).join('')
    document.getElementById('log-count').textContent = `${rows.length} legs`
  }
}

export function setLogView(v) {
  state.logView = v
  document.getElementById('toggle-trades').classList.toggle('active', v === 'trades')
  document.getElementById('toggle-legs').classList.toggle('active', v === 'legs')
  document.getElementById('log-trades-view').style.display = v === 'trades' ? 'block' : 'none'
  document.getElementById('log-legs-view').style.display   = v === 'legs'   ? 'block' : 'none'
  renderLog()
}

export function clearLogDates() {
  document.getElementById('log-date-from').value = ''
  document.getElementById('log-date-to').value   = ''
  renderLog()
}

export function populateLogFilters() {
  const underlyings = [...new Set(allRows().map((r) => getUnderlying(r.symbol || '')))].sort()
  const sel = document.getElementById('log-underlying')
  sel.innerHTML = '<option value="">All underlyings</option>' + underlyings.map((u) => `<option>${u}</option>`).join('')
}

export function renderUnderlying() {
  const rows = allRows()
  const byU  = {}
  rows.forEach((r) => {
    const u = getUnderlying(r.symbol || '')
    if (!byU[u]) byU[u] = { pnl: 0, count: 0 }
    byU[u].pnl += parseFloat(r.gainLoss) || 0
    byU[u].count++
  })

  const sorted = Object.entries(byU).sort((a, b) => b[1].pnl - a[1].pnl)
  const maxAbs = Math.max(...sorted.map(([, v]) => Math.abs(v.pnl)))

  document.getElementById('underlying-bars').innerHTML = sorted.map(([u, v]) => `
    <div class="underlying-row">
      <div class="underlying-name">${u}</div>
      <div class="underlying-bar-wrap">
        <div class="underlying-bar ${v.pnl >= 0 ? 'pos' : 'neg'}" style="width:${Math.abs(v.pnl) / maxAbs * 100}%"></div>
      </div>
      <div class="underlying-val ${v.pnl >= 0 ? 'pos' : 'neg'}">${fmt(v.pnl, 0)}</div>
    </div>`).join('')

  if (underlyingCountChart) underlyingCountChart.destroy()
  const colors = ['#4ade80', '#60a5fa', '#fbbf24', '#f87171', '#a78bfa', '#34d399']
  underlyingCountChart = new Chart(document.getElementById('underlyingCountChart'), {
    type: 'doughnut',
    data: { labels: sorted.map(([u]) => u), datasets: [{ data: sorted.map(([, v]) => v.count), backgroundColor: colors.map((c) => c + '99'), borderColor: colors, borderWidth: 1 }] },
    options: { ...getChartCfg(), cutout: '60%', plugins: { ...getChartCfg().plugins, legend: { display: true, position: 'right', labels: { color: '#7a8090', font: { size: 10 } } } } },
  })

  const series      = allSeries()
  const underlyings = sorted.map(([u]) => u)
  const datasets    = underlyings.slice(0, 4).map((u, i) => {
    const byDate = {}
    rows.filter((r) => getUnderlying(r.symbol || '') === u).forEach((r) => {
      byDate[r.closeDate] = (byDate[r.closeDate] || 0) + (parseFloat(r.gainLoss) || 0)
    })
    let cum = 0
    return { label: u, data: series.map((s) => { cum += (byDate[s.date] || 0); return cum }), borderColor: colors[i], borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false }
  })

  if (underlyingLineChart) underlyingLineChart.destroy()
  const theme = localStorage.getItem('gg-theme') || 'dark'
  const t     = THEMES[theme] || THEMES.dark
  underlyingLineChart = new Chart(document.getElementById('underlyingLineChart'), {
    type: 'line',
    data: { labels: series.map((s) => s.date.slice(5)), datasets },
    options: {
      ...getChartCfg(),
      plugins: { ...getChartCfg().plugins, legend: { display: true, labels: { color: '#7a8090', font: { size: 10 } } } },
      scales:  { x: { display: true, grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { grid: { color: t.chartGrid }, ticks: { callback: (v) => fmt(v, 0) } } },
    },
  })
}

export function renderMonthly() {
  const series     = allSeries()
  const byMonth    = {}
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  series.forEach((s) => {
    const m = s.date.slice(0, 7)
    if (!byMonth[m]) byMonth[m] = { pnl: 0, days: 0, wins: 0 }
    byMonth[m].pnl += s.daily
    byMonth[m].days++
    if (s.daily > 0) byMonth[m].wins++
  })
  const months = Object.keys(byMonth).sort()
  if (!months.length) return

  const best = months.reduce((a, b) => byMonth[b].pnl > byMonth[a].pnl ? b : a)
  document.getElementById('monthly-best-label').textContent =
    `Best: ${monthNames[parseInt(best.slice(5)) - 1]} ${fmt(byMonth[best].pnl, 0)}`

  if (monthlyChart) monthlyChart.destroy()
  const theme = localStorage.getItem('gg-theme') || 'dark'
  const t     = THEMES[theme] || THEMES.dark
  monthlyChart = new Chart(document.getElementById('monthlyChart'), {
    type: 'bar',
    data: {
      labels:   months.map((m) => monthNames[parseInt(m.slice(5)) - 1]),
      datasets: [{
        data:            months.map((m) => byMonth[m].pnl),
        backgroundColor: months.map((m) => byMonth[m].pnl >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(248,113,113,0.65)'),
        borderColor:     months.map((m) => byMonth[m].pnl >= 0 ? '#4ade80' : '#f87171'),
        borderWidth: 1, borderRadius: 3,
      }],
    },
    options: {
      ...getChartCfg(),
      layout: { padding: { bottom: 4 } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0 } }, y: { grid: { color: t.chartGrid }, ticks: { callback: (v) => fmt(v, 0) } } },
      plugins: {
        ...getChartCfg().plugins,
        tooltip: {
          ...getChartCfg().plugins.tooltip,
          callbacks: {
            label: (ctx) => {
              const m  = months[ctx.dataIndex]
              const v  = byMonth[m]
              const wr = Math.round(v.wins / v.days * 100)
              return [` P&L: ${fmt(ctx.raw, 0)}`, ` Trades: ${v.days}   WR: ${wr}%`]
            },
          },
        },
      },
    },
  })
}
