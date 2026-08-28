#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SONDA: ¿se pueden conseguir NIM y CET1 para los bancos del S&P?
================================================================

Por qué existe
--------------
Marcos pidió medir a los bancos con métricas propias del sector: ROE, ROA,
CET1 y NIM. ROE y ROA ya están. Los otros dos NO están en `info` de yfinance,
así que hay que ver de dónde salen — y antes de escribir el código de
producción hay que COMPROBAR que los datos existen.

Esto ya nos pasó: la integración de la tesis con IA se escribió sin haber
llamado nunca a la API de verdad, y todavía está sin verificar. Esta sonda
existe para no repetirlo.

⚠️ ESTA SONDA NO ESCRIBE NADA EN public/data/. Solo mide y reporta.

Qué prueba
----------
Para cada banco, y por varios caminos:

  NIM (margen de interés neto)
    = ingreso neto por intereses / activos rentables promedio
    Ruta A: yfinance income_stmt, fila "Net Interest Income"
    Ruta B: yfinance quarterly_income_stmt, suma de 4 trimestres (TTM)
    Ruta C: Interest Income - Interest Expense, si no está la fila neta
    Denominador: balance_sheet "Total Assets"

    ⚠️ Es un PROXY. El NIM real usa activos RENTABLES promedio (sin goodwill
    ni inmuebles), que da ~10-15% menos que activos totales, así que el número
    va a salir más bajo que el que publica el banco. Para un ranking RELATIVO
    entre bancos ordena casi igual, que es para lo que lo queremos. Si se
    muestra en pantalla hay que aclarar que es aproximado.

  CET1 (capital común nivel 1 sobre activos ponderados por riesgo)
    Ruta A: SEC XBRL companyconcept, varias etiquetas candidatas
    Ruta B: yfinance info (casi seguro que no está, se prueba igual)

    ⚠️ La sospecha es que CET1 NO tiene una etiqueta us-gaap estándar: cada
    banco la publica como extensión propia, y entonces la API de la SEC no la
    encuentra de forma uniforme. Esta sonda es justamente para confirmarlo o
    desmentirlo con datos.

Uso
---
    cd local_bot
    python probe_bancos.py

Salida: una tabla por banco con qué se consiguió y por qué ruta, más un
veredicto final de cobertura. Nada más.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print('[X] Falta yfinance. Instalalo con: pip install "yfinance>=1.4.1"')
    sys.exit(1)

# La SEC pide identificarse. NO bloquea IPs de nube ni residenciales.
SEC_UA = 'sp500-screener marcoscabello12@gmail.com'

# Los 17 bancos, tomados de `industry` del snapshot. Se recalcula abajo desde
# el archivo real para no dejar la lista clavada a mano.
INDUSTRIAS_BANCO = {'Banks - Diversified', 'Banks - Regional', 'Credit Services'}

# Etiquetas candidatas para CET1 en XBRL. Se prueban todas: la primera que
# devuelva algo gana. Si ninguna anda en la mayoria de los bancos, la
# conclusion es que CET1 no se puede automatizar por esta via.
TAGS_CET1 = [
    ('us-gaap', 'CommonEquityTierOneCapitalToRiskWeightedAssets'),
    ('us-gaap', 'TierOneRiskBasedCapitalToRiskWeightedAssets'),
    ('us-gaap', 'BankingRegulationCommonEquityTierOneCapitalToRiskWeightedAssets'),
    ('us-gaap', 'BankingRegulationTierOneRiskBasedCapitalToRiskWeightedAssets'),
    ('srt',     'CommonEquityTierOneCapitalToRiskWeightedAssets'),
]

FILAS_NII = ['Net Interest Income', 'NetInterestIncome',
             'Net Interest Income Expense', 'Total Net Interest Income']
FILAS_ING = ['Interest Income', 'Total Interest Income', 'InterestIncome']
FILAS_EGR = ['Interest Expense', 'Total Interest Expense', 'InterestExpense']
FILAS_ACT = ['Total Assets', 'TotalAssets']


def _fila(df, nombres):
    """Busca una fila del estado contable por varios nombres posibles.
    yfinance cambia los nombres entre versiones, asi que se prueban varios y
    ademas se busca sin distinguir mayusculas."""
    if df is None or df.empty:
        return None
    idx = {str(i).strip().lower(): i for i in df.index}
    for n in nombres:
        real = idx.get(n.strip().lower())
        if real is not None:
            serie = df.loc[real].dropna()
            if len(serie):
                return serie
    return None


def cik_de(sym, mapa):
    return mapa.get(sym.replace('-', '.').upper()) or mapa.get(sym.upper())


def cargar_mapa_cik():
    """SEC -> {TICKER: CIK de 10 digitos}."""
    try:
        req = urllib.request.Request(
            'https://www.sec.gov/files/company_tickers.json',
            headers={'User-Agent': SEC_UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read().decode('utf-8'))
        return {v['ticker'].upper(): str(v['cik_str']).zfill(10) for v in d.values()}
    except Exception as e:
        print(f'  [aviso] no pude bajar el mapa de CIK ({type(e).__name__}: {e})')
        return {}


def probar_cet1(sym, cik):
    """Devuelve (valor, etiqueta_que_funciono) o (None, None)."""
    if not cik:
        return None, None
    for ns, tag in TAGS_CET1:
        url = (f'https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/{ns}/{tag}.json')
        try:
            req = urllib.request.Request(url, headers={'User-Agent': SEC_UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                d = json.loads(r.read().decode('utf-8'))
        except Exception:
            continue        # 404 = ese banco no usa esa etiqueta
        # Se toma el dato mas reciente de cualquier unidad
        mejor = None
        for unidad, puntos in (d.get('units') or {}).items():
            for p in puntos:
                fin = p.get('end')
                if fin and p.get('val') is not None:
                    if mejor is None or fin > mejor[0]:
                        mejor = (fin, p['val'], unidad)
        if mejor:
            return {'valor': mejor[1], 'fecha': mejor[0], 'unidad': mejor[2]}, f'{ns}:{tag}'
        time.sleep(0.15)    # la SEC pide <= 10 req/s
    return None, None


def probar_nim(tk):
    """Devuelve (nim_pct, ruta, detalle) o (None, motivo, None)."""
    try:
        bs = tk.balance_sheet
    except Exception as e:
        return None, f'balance_sheet fallo: {type(e).__name__}', None
    activos = _fila(bs, FILAS_ACT)
    if activos is None:
        return None, 'sin "Total Assets" en el balance', None
    act = float(activos.iloc[0])
    if act <= 0:
        return None, 'activos <= 0', None

    # Ruta A: anual, fila neta
    try:
        ist = tk.income_stmt
    except Exception:
        ist = None
    nii = _fila(ist, FILAS_NII)
    if nii is not None:
        return float(nii.iloc[0]) / act * 100, 'A (anual, fila neta)', f'NII={float(nii.iloc[0])/1e9:.1f}B act={act/1e9:.0f}B'

    # Ruta C: anual, ingreso - egreso
    ing, egr = _fila(ist, FILAS_ING), _fila(ist, FILAS_EGR)
    if ing is not None and egr is not None:
        v = float(ing.iloc[0]) - float(egr.iloc[0])
        return v / act * 100, 'C (anual, ingreso-egreso)', f'NII={v/1e9:.1f}B act={act/1e9:.0f}B'

    # Ruta B: trimestral TTM
    try:
        qst = tk.quarterly_income_stmt
    except Exception:
        qst = None
    qnii = _fila(qst, FILAS_NII)
    if qnii is not None and len(qnii) >= 4:
        v = float(qnii.iloc[:4].sum())
        return v / act * 100, 'B (TTM, 4 trimestres)', f'NII={v/1e9:.1f}B act={act/1e9:.0f}B'

    filas = list(ist.index)[:12] if ist is not None and not ist.empty else []
    return None, 'ninguna fila de intereses', f'filas vistas: {filas}'


def main():
    base = Path(__file__).resolve().parent
    snap = base.parent / 'public' / 'data' / 'sp500_fundamentals.json'
    if not snap.exists():
        print(f'[X] No encuentro {snap}. Corre antes fetch_fundamentals.py')
        sys.exit(1)
    d = json.loads(snap.read_text(encoding='utf-8'))
    bancos = [s for s in d['stocks']
              if s.get('sector') == 'Financials'
              and s.get('industry') in INDUSTRIAS_BANCO]
    if not bancos:
        print('[X] Ningun banco encontrado. ¿El snapshot tiene el campo `industry`?')
        print('    Si no lo tiene, volve a correr fetch_fundamentals.py con el bot')
        print('    actualizado (el que guarda `industry`).')
        sys.exit(1)

    print(f'yfinance {yf.__version__} | {len(bancos)} bancos\n')
    print('Bajando el mapa de CIK de la SEC...')
    mapa = cargar_mapa_cik()
    print(f'   {len(mapa)} tickers mapeados\n')

    print(f'{"sym":6s} {"NIM aprox":>10s}  {"ruta":<26s} {"CET1":>8s}  etiqueta')
    print('-' * 92)
    ok_nim = ok_cet1 = 0
    motivos_nim, detalles = {}, {}
    for s in bancos:
        sym = s['symbol']
        tk = yf.Ticker(sym)
        nim, ruta, det = probar_nim(tk)
        cet1, tag = probar_cet1(sym, cik_de(sym, mapa))
        if nim is not None:
            ok_nim += 1
            snim = f'{nim:.2f}%'
        else:
            snim = '—'
            motivos_nim[ruta] = motivos_nim.get(ruta, 0) + 1
            if det:
                detalles[sym] = det
        if cet1 is not None:
            ok_cet1 += 1
            v = cet1['valor']
            scet1 = f'{v*100:.2f}%' if v < 1 else f'{v:.2f}%'
        else:
            scet1 = '—'
        print(f'{sym:6s} {snim:>10s}  {(ruta or "")[:26]:<26s} {scet1:>8s}  {tag or ""}')
        time.sleep(0.4)

    n = len(bancos)
    print('\n' + '=' * 92)
    print(f'NIM  : {ok_nim}/{n} ({100*ok_nim/n:.0f}%)')
    print(f'CET1 : {ok_cet1}/{n} ({100*ok_cet1/n:.0f}%)')
    if motivos_nim:
        print('\nPor que fallo el NIM:')
        for m, c in sorted(motivos_nim.items(), key=lambda x: -x[1]):
            print(f'   {c:2d}x  {m}')
    for sym, det in list(detalles.items())[:3]:
        print(f'\n   {sym}: {det}')

    print('\n--- QUE SIGNIFICA ---')
    umbral = 0.80
    if ok_nim >= n * umbral:
        print(f'[OK]  NIM: cobertura suficiente ({ok_nim}/{n}). Se puede automatizar.')
        print('      Recordar que es un PROXY sobre activos TOTALES, no rentables:')
        print('      va a dar mas bajo que el que publica el banco. Sirve para')
        print('      ordenar entre bancos, no para citar el numero.')
    else:
        print(f'[NO]  NIM: cobertura insuficiente ({ok_nim}/{n}). No conviene.')
    if ok_cet1 >= n * umbral:
        print(f'[OK]  CET1: cobertura suficiente ({ok_cet1}/{n}). Se puede automatizar.')
    else:
        print(f'[NO]  CET1: cobertura insuficiente ({ok_cet1}/{n}).')
        print('      Era la sospecha: cada banco lo publica con una etiqueta propia,')
        print('      asi que la API de la SEC no lo encuentra de forma uniforme.')
        print('      Sacarlo de ahi requeriria parsear el texto del 10-Q banco por')
        print('      banco, que se rompe cada vez que uno cambia el formato.')
    print('\nEsta sonda NO escribio nada. Manda la salida y con eso se decide.')


if __name__ == '__main__':
    main()
