import { THEMES } from './constants.js'

// Apply Chart.js global defaults on module load
/* global Chart */
Chart.defaults.color       = '#5a6070'
Chart.defaults.borderColor = '#1e2330'
Chart.defaults.font.family = "'DM Mono', monospace"
Chart.defaults.font.size   = 11

export function getChartCfg() {
  const theme = localStorage.getItem('gg-theme') || 'dark'
  const t = THEMES[theme] || THEMES.dark
  return {
    responsive:          true,
    maintainAspectRatio: true,
    plugins: {
      legend:  { display: false },
      tooltip: {
        backgroundColor: t.tooltipBg,
        borderColor:     t.tooltipBorder,
        borderWidth:     1,
        titleColor:      t.tooltipTitle,
        bodyColor:       t.tooltipBody,
        padding:         10,
      },
    },
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '')
  const t = THEMES[theme] || THEMES.dark
  Chart.defaults.color       = t.chartColor
  Chart.defaults.borderColor = t.chartGrid
  const icon  = document.getElementById('theme-icon')
  const label = document.getElementById('theme-label')
  if (icon)  icon.textContent  = theme === 'light' ? '🌙' : '☀️'
  if (label) label.textContent = theme === 'light' ? 'Dark Mode' : 'Light Mode'
  localStorage.setItem('gg-theme', theme)
}
