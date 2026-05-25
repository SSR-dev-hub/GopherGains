export const TICKER_ALIASES = {
  SPXW: 'SPX', NDXP: 'NDX', DJXW: 'DJX', RUTW: 'RUT', NQXP: 'NQX', MGTNW: 'MGTN',
}

export const THEMES = {
  dark: {
    chartColor: '#5a6070', chartGrid: '#1e2330',
    tooltipBg: '#181c23', tooltipBorder: '#252c3d', tooltipTitle: '#e8eaf0', tooltipBody: '#7a8090',
  },
  light: {
    chartColor: '#7a8090', chartGrid: '#dde1ea',
    tooltipBg: '#ffffff', tooltipBorder: '#d4d8e0', tooltipTitle: '#111318', tooltipBody: '#5a6070',
  },
}

export const TYPE_CHIP_LABEL = { PS: 'PS', CS: 'CS', IC: 'IC', P: 'P', C: 'C', STOCK: '' }
export const TYPE_BADGE_CLS  = { PS: 'put', CS: 'call', IC: 'ic', P: 'put', C: 'call', STOCK: '' }
export const TYPE_FULL_LABEL = { PS: 'Put Spread', CS: 'Call Spread', IC: 'Iron Condor', P: 'Put', C: 'Call', STOCK: 'Stock' }
export const TICKER_CLS_MAP  = { NDX: 'ndx', QQQ: 'qqq', SPX: 'spx', SPY: 'spy', DJX: 'other', RUT: 'other' }
