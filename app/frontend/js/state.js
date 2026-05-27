const now = new Date()

export const state = {
  rows:           [],
  calYear:        now.getFullYear(),
  calMonth:       now.getMonth(),
  logView:        'trades',
  todayTentative: null, // { date, totalPnl, spreads } from orders API — excluded from all stats
}
