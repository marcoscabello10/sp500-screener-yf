from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import yfinance as yf

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
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
        self.wfile.write(json.dumps(result, default=str).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

    def _dispatch(self, action, params):

        # ── action=sp500 ──────────────────────────────────────────────────────
        if action == 'sp500':
            import urllib.request, re

            # Mapa de normalización: cualquier variante → nombre exacto que usa App.jsx
            SECTOR_MAP = {
                # Inglés canónico (Wikipedia EN)
                'Information Technology': 'Technology',
                'Health Care': 'Healthcare',
                'Financials': 'Financials',
                'Consumer Discretionary': 'Consumer Discretionary',
                'Communication Services': 'Communication Services',
                'Industrials': 'Industrials',
                'Consumer Staples': 'Consumer Staples',
                'Energy': 'Energy',
                'Utilities': 'Utilities',
                'Real Estate': 'Real Estate',
                'Materials': 'Materials',
                # Español (por si Wikipedia devuelve versión traducida)
                'Tecnología de la información': 'Technology',
                'Tecnología': 'Technology',
                'Atención sanitaria': 'Healthcare',
                'Salud': 'Healthcare',
                'Cuidado de la salud': 'Healthcare',
                'Finanzas': 'Financials',
                'Servicios financieros': 'Financials',
                'Consumo discrecional': 'Consumer Discretionary',
                'Bienes de consumo discrecional': 'Consumer Discretionary',
                'Servicios de comunicación': 'Communication Services',
                'Comunicaciones': 'Communication Services',
                'Industria': 'Industrials',
                'Industriales': 'Industrials',
                'Artículos de primera necesidad': 'Consumer Staples',
                'Consumo básico': 'Consumer Staples',
                'Productos de primera necesidad': 'Consumer Staples',
                'Energía': 'Energy',
                'Servicios públicos': 'Utilities',
                'Inmobiliario': 'Real Estate',
                'Bienes raíces': 'Real Estate',
                'Materiales': 'Materials',
            }

            url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0',
                'Accept-Language': 'en-US,en;q=0.9',  # forzar inglés
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode('utf-8')
            rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
            constituents = []
            for row in rows[1:]:
                cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                if len(cells) >= 4:
                    sym    = re.sub(r'<[^>]+>', '', cells[0]).strip().replace('.', '-')
                    name   = re.sub(r'<[^>]+>', '', cells[1]).strip()
                    sector_raw = re.sub(r'<[^>]+>', '', cells[3]).strip()
                    # Normalizar sector — primero buscar en mapa, si no está dejarlo como está
                    sector = SECTOR_MAP.get(sector_raw, sector_raw)
                    if sym and 1 <= len(sym) <= 5 and sector:
                        constituents.append({'symbol': sym, 'name': name, 'sector': sector})
            return constituents

        # ── action=quote&symbols=AAPL,MSFT ───────────────────────────────────
        elif action == 'quote':
            symbols_raw = params.get('symbols', [''])[0]
            symbols = [s.strip() for s in symbols_raw.split(',') if s.strip()]
            if not symbols:
                return []
            result = []
            # Usamos .info en lugar de fast_info para obtener datos completos
            for sym in symbols:
                try:
                    info = yf.Ticker(sym).info
                    price      = info.get('currentPrice') or info.get('regularMarketPrice') or info.get('previousClose') or 0
                    prev_close = info.get('previousClose') or info.get('regularMarketPreviousClose') or 0
                    change_pct = round(((price - prev_close) / prev_close * 100), 4) if prev_close else 0
                    result.append({
                        'symbol':            sym,
                        'price':             price,
                        'marketCap':         info.get('marketCap') or 0,
                        'pe':                info.get('trailingPE') or info.get('forwardPE') or None,
                        'changesPercentage': change_pct,
                        'name':              info.get('shortName', sym),
                        'exchange':          info.get('exchange', ''),
                    })
                except Exception:
                    result.append({'symbol': sym, 'price': 0, 'marketCap': 0,
                                   'pe': None, 'changesPercentage': 0, 'name': sym})
            return result

        # ── action=ratios&symbol=AAPL ─────────────────────────────────────────
        elif action == 'ratios':
            sym = params.get('symbol', [''])[0].strip()
            if not sym:
                return [{}]
            info = yf.Ticker(sym).info
            return [{
                'symbol':                       sym,
                'peRatioTTM':                   info.get('trailingPE'),
                'priceToBookRatioTTM':          info.get('priceToBook'),
                'returnOnEquityTTM':            info.get('returnOnEquity'),
                'debtEquityRatioTTM':           (info.get('debtToEquity') or 0) / 100 if info.get('debtToEquity') is not None else None,
                'enterpriseValueMultipleTTM':   info.get('enterpriseToEbitda'),
                'netProfitMarginTTM':           info.get('profitMargins'),
                'dividendYieldTTM':             info.get('dividendYield'),
                'currentRatioTTM':              info.get('currentRatio'),
            }]

        # ── action=profile&symbols=AAPL,MSFT ─────────────────────────────────
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
                        'symbol':      sym,
                        'sector':      info.get('sector', 'Unknown'),
                        'companyName': info.get('shortName', sym),
                        'industry':    info.get('industry', ''),
                        'mktCap':      info.get('marketCap', 0),
                    })
                except Exception:
                    result.append({'symbol': sym, 'sector': 'Unknown', 'companyName': sym})
            return result

        # ── action=history&symbol=AAPL&from=2019-01-01 ───────────────────────
        elif action == 'history':
            sym       = params.get('symbol', [''])[0].strip()
            from_date = params.get('from',   ['2019-01-01'])[0]
            if not sym:
                return []
            df = yf.download(sym, start=from_date, progress=False, auto_adjust=True)
            if df.empty:
                return []
            # Aplanar MultiIndex si existe
            if hasattr(df.columns, 'levels'):
                df.columns = df.columns.get_level_values(0)
            result = []
            for date, row in df.iterrows():
                try:
                    result.append({
                        'date':     date.strftime('%Y-%m-%d'),
                        'close':    round(float(row['Close']), 4),
                        'adjClose': round(float(row['Close']), 4),
                        'open':     round(float(row['Open']),  4),
                        'high':     round(float(row['High']),  4),
                        'low':      round(float(row['Low']),   4),
                        'volume':   int(row['Volume']),
                    })
                except Exception:
                    pass
            return result

        else:
            return {'error': f'action desconocida: {action}'}
