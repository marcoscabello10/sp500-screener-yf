from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import yfinance as yf

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        # CORS
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.end_headers()

        params = parse_qs(urlparse(self.path).query)
        action = params.get('action', [''])[0]

        try:
            result = self._dispatch(action, params)
        except Exception as e:
            result = {'error': str(e)}

        self.wfile.write(json.dumps(result).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.end_headers()

    def _dispatch(self, action, params):

        # ── action=sp500 ─────────────────────────────────────────────────────
        # Devuelve lista de constituyentes del S&P 500 con símbolo y nombre
        if action == 'sp500':
            tickers = yf.Tickers('')
            sp500 = yf.download(
                tickers='SPY',
                period='1d',
                progress=False,
                auto_adjust=True
            )
            # Usamos la lista hardcodeada via screener de yfinance
            import urllib.request
            url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                html = resp.read().decode('utf-8')
            # Parseo simple de la tabla Wikipedia
            import re
            rows = re.findall(r'<tr[^>]*>.*?</tr>', html, re.DOTALL)
            constituents = []
            for row in rows[1:]:
                cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                if len(cells) >= 4:
                    sym = re.sub(r'<[^>]+>', '', cells[0]).strip().replace('.', '-')
                    name = re.sub(r'<[^>]+>', '', cells[1]).strip()
                    sector = re.sub(r'<[^>]+>', '', cells[3]).strip()
                    if sym and len(sym) <= 5:
                        constituents.append({'symbol': sym, 'name': name, 'sector': sector})
            return constituents

        # ── action=quote&symbols=AAPL,MSFT ───────────────────────────────────
        # Devuelve precio, marketCap, pe, changesPercentage para cada símbolo
        elif action == 'quote':
            symbols_raw = params.get('symbols', [''])[0]
            symbols = [s.strip() for s in symbols_raw.split(',') if s.strip()]
            if not symbols:
                return []
            data = yf.Tickers(' '.join(symbols))
            result = []
            for sym in symbols:
                try:
                    info = data.tickers[sym].fast_info
                    full = data.tickers[sym].info
                    prev_close = info.previous_close or 0
                    price = info.last_price or 0
                    change_pct = ((price - prev_close) / prev_close * 100) if prev_close else 0
                    result.append({
                        'symbol': sym,
                        'price': price,
                        'marketCap': info.market_cap or 0,
                        'pe': full.get('trailingPE') or full.get('forwardPE') or None,
                        'changesPercentage': round(change_pct, 4),
                        'name': full.get('shortName', sym),
                        'exchange': full.get('exchange', ''),
                    })
                except Exception:
                    result.append({'symbol': sym, 'price': 0, 'marketCap': 0, 'pe': None, 'changesPercentage': 0})
            return result

        # ── action=ratios&symbol=AAPL ─────────────────────────────────────────
        # Devuelve ratios TTM: pe, pb, roe, debtEquity, evEbitda, margen
        elif action == 'ratios':
            sym = params.get('symbol', [''])[0].strip()
            if not sym:
                return {}
            info = yf.Ticker(sym).info
            return [{
                'symbol': sym,
                # Nombres compatibles con los que espera App.jsx (campo FMP → yfinance)
                'peRatioTTM':              info.get('trailingPE'),
                'pbRatioTTM':              info.get('priceToBook'),
                'roeTTM':                  info.get('returnOnEquity'),
                'debtEquityRatioTTM':      info.get('debtToEquity'),
                'enterpriseValueMultipleTTM': info.get('enterpriseToEbitda'),
                'netProfitMarginTTM':      info.get('profitMargins'),
                # Extras útiles
                'dividendYieldTTM':        info.get('dividendYield'),
                'currentRatioTTM':         info.get('currentRatio'),
            }]

        # ── action=profile&symbols=AAPL,MSFT ─────────────────────────────────
        # Devuelve sector y nombre para cada símbolo
        elif action == 'profile':
            symbols_raw = params.get('symbols', [''])[0]
            symbols = [s.strip() for s in symbols_raw.split(',') if s.strip()]
            if not symbols:
                return []
            result = []
            for sym in symbols:
                try:
                    info = yf.Ticker(sym).info
                    result.append({
                        'symbol': sym,
                        'sector': info.get('sector', 'Unknown'),
                        'companyName': info.get('shortName', sym),
                        'industry': info.get('industry', ''),
                        'mktCap': info.get('marketCap', 0),
                    })
                except Exception:
                    result.append({'symbol': sym, 'sector': 'Unknown', 'companyName': sym})
            return result

        # ── action=history&symbol=AAPL&from=2019-01-01 ───────────────────────
        # Devuelve histórico de precios diarios desde `from`
        elif action == 'history':
            sym = params.get('symbol', [''])[0].strip()
            from_date = params.get('from', ['2019-01-01'])[0]
            if not sym:
                return []
            df = yf.download(sym, start=from_date, progress=False, auto_adjust=True)
            if df.empty:
                return []
            # Aplanar MultiIndex si existe (yfinance a veces lo genera)
            if hasattr(df.columns, 'levels'):
                df.columns = df.columns.get_level_values(0)
            result = []
            for date, row in df.iterrows():
                result.append({
                    'date': date.strftime('%Y-%m-%d'),
                    'close': round(float(row['Close']), 4),
                    'adjClose': round(float(row['Close']), 4),
                    'open':   round(float(row['Open']), 4),
                    'high':   round(float(row['High']), 4),
                    'low':    round(float(row['Low']), 4),
                    'volume': int(row['Volume']),
                })
            return result

        else:
            return {'error': f'action desconocida: {action}'}
