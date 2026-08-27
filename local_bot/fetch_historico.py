#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Snapshot de PRECIOS HISTÓRICOS — reemplaza a Twelve Data
=========================================================

Por qué existe
--------------
Hoy F2/F3/F4 le piden el histórico a Twelve Data desde Vercel, en vivo. Eso
tiene tres problemas medidos:

  1. **Tarda.** El plan gratuito da 8 créditos por minuto. Bajar 505 símbolos
     con 6 años son 85 lotes de 62 segundos: **88 minutos**.
  2. **El caché no ayudaba.** Guardaba 7 campos por día cuando el screener usa
     2, así que superaba la cuota de localStorage y se descartaba en silencio.
     (Eso se arregló aparte, en `adelgazarHist` dentro de App.jsx.)
  3. **No ajusta por dividendos.** `api/data.py` escribe `adjClose = close`, o
     sea que los retornos que alimentan volatilidad, beta y correlación ignoran
     los dividendos.

Este bot corre en la PC de Marcos, donde Yahoo SÍ responde (la regla de oro #4
del proyecto dice que Vercel no puede llamar a Yahoo, pero la PC sí). Con
`yf.download()` se bajan cientos de símbolos por llamada: los mismos 634 papeles
salen en **minutos**, no en hora y media.

⚠️ LOS NÚMEROS VAN A MOVERSE
-----------------------------
Este bot baja precios **ajustados por dividendos y splits** (`auto_adjust=True`).
Twelve Data devuelve el cierre crudo. Por eso las volatilidades, betas y
correlaciones calculadas con este snapshot NO van a coincidir exactamente con
las de hoy. Van a estar **mejor**, pero distintas.

Por eso el snapshot se genera primero y no reemplaza nada: hay que correr las
dos fuentes en paralelo sobre los mismos tickers y comparar ANTES de sacar el
camino viejo.

Formato de salida
-----------------
Eje de fechas compartido, y una lista de cierres por símbolo alineada a ese eje.
Repetir la fecha en cada punto de cada símbolo multiplicaría el tamaño por tres.

    {
      "generated_at": "...", "desde": "2020-01-01", "ajustado": true,
      "fechas":  ["2020-01-02", "2020-01-03", ...],
      "series":  {"AAPL": [72.88, 72.17, ...], "SPY": [...]},
      "cobertura": {"AAPL": {"desde": 0, "puntos": 1512}}
    }

`null` en una serie = ese día el papel no cotizaba (IPO posterior, suspensión).
Quien lo consuma tiene que saltearlos, NO rellenarlos: rellenar inventa un
retorno de 0% que baja la volatilidad artificialmente.

Uso
---
    cd local_bot
    python fetch_historico.py                 # S&P 500 + SPY + CEDEARs, 6 años
    python fetch_historico.py --anios 10
    python fetch_historico.py --solo AAPL MSFT SPY     # para comparar contra TD
    python fetch_historico.py --sin-cedears

Salida: public/data/historico_precios.json  (~8 MB con 6 años y 634 símbolos)
"""
import json
import sys
import time
from datetime import datetime, timezone, date
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print('[X] Falta yfinance. Instalalo con: pip install "yfinance>=1.4.1"')
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    print('[X] Falta pandas. Instalalo con: pip install pandas')
    sys.exit(1)

ANIOS_DEFECTO = 6
LOTE = 60           # yf.download acepta muchos; 60 mantiene los errores acotados
PAUSA = 1.0         # respiro entre lotes, para no parecer un scraper


def leer_universo(data_dir, base_dir, con_cedears=True):
    """SPY + las 503 del S&P (del snapshot del screener) + los CEDEAR del informe.

    SPY va primero y es obligatorio: es el benchmark contra el que F2/F3/F4
    calculan beta y correlación. Sin SPY, esas tres fases no tienen contra qué
    comparar."""
    simbolos = ['SPY']

    p = data_dir / 'sp500_fundamentals.json'
    if p.exists():
        try:
            d = json.loads(p.read_text(encoding='utf-8'))
            simbolos += [s['symbol'] for s in d.get('stocks', []) if s.get('symbol')]
        except Exception as e:
            print(f'  [aviso] no pude leer sp500_fundamentals.json ({type(e).__name__})')
    else:
        print('  [aviso] no encuentro sp500_fundamentals.json; corre antes fetch_fundamentals.py')

    if con_cedears:
        q = base_dir / 'cedears_ok.txt'
        if q.exists():
            extra = [l.split('#')[0].strip().upper()
                     for l in q.read_text(encoding='utf-8').splitlines()]
            extra = [t for t in extra if t]
            simbolos += extra
            print(f'  + {len(extra)} CEDEAR de cedears_ok.txt')
        else:
            print('  [aviso] no encuentro cedears_ok.txt; solo el S&P 500')

    return list(dict.fromkeys(simbolos))   # sin duplicados, conservando el orden


def bajar_lote(simbolos, desde):
    """Un yf.download por lote. Devuelve {simbolo: Series de cierres ajustados}.

    auto_adjust=True es OBLIGATORIO: sin eso, un split parte la serie al medio y
    el retorno de ese día sale como una caída del 50% que nunca ocurrió."""
    df = yf.download(simbolos, start=desde, interval='1d',
                     auto_adjust=True, progress=False,
                     group_by='column', threads=True)
    if df is None or df.empty:
        return {}

    out = {}
    # Con varios simbolos las columnas son MultiIndex (campo, simbolo);
    # con uno solo son planas. Hay que soportar los dos.
    if isinstance(df.columns, pd.MultiIndex):
        if 'Close' not in df.columns.get_level_values(0):
            return {}
        cierres = df['Close']
        for sym in cierres.columns:
            out[str(sym)] = cierres[sym]
    else:
        if 'Close' not in df.columns:
            return {}
        out[simbolos[0]] = df['Close']
    return out


def main():
    args = sys.argv[1:]
    flags = {a for a in args if a.startswith('--')}
    con_cedears = '--sin-cedears' not in flags

    anios = ANIOS_DEFECTO
    if '--anios' in args:
        try:
            anios = int(args[args.index('--anios') + 1])
        except Exception:
            print('[X] --anios necesita un numero. Ej: --anios 10')
            sys.exit(1)

    solo = []
    if '--solo' in args:
        solo = [a.upper() for a in args[args.index('--solo') + 1:]
                if not a.startswith('--')]

    base_dir = Path(__file__).resolve().parent
    data_dir = base_dir.parent / 'public' / 'data'
    salida = data_dir / 'historico_precios.json'

    desde = f'{date.today().year - anios}-01-01'

    print(f'yfinance {yf.__version__} | python {sys.version.split()[0]}')
    if solo:
        simbolos = list(dict.fromkeys(['SPY'] + solo))
        print(f'Modo --solo: {len(simbolos)} simbolos')
    else:
        simbolos = leer_universo(data_dir, base_dir, con_cedears)
    print(f'Universo: {len(simbolos)} simbolos desde {desde} ({anios} anios)\n')
    if not simbolos:
        print('[X] No hay simbolos que bajar.')
        sys.exit(1)

    t0 = time.time()
    series = {}
    fallidos = []
    lotes = [simbolos[i:i + LOTE] for i in range(0, len(simbolos), LOTE)]
    for i, lote in enumerate(lotes, 1):
        print(f'  [{i}/{len(lotes)}] {len(lote)} simbolos ...', end='', flush=True)
        try:
            got = bajar_lote(lote, desde)
        except Exception as e:
            print(f' ERROR: {type(e).__name__}: {e}')
            fallidos += lote
            continue
        vacios = 0
        for sym in lote:
            s = got.get(sym)
            if s is None or s.dropna().empty:
                vacios += 1
                fallidos.append(sym)
                continue
            series[sym] = s.dropna()
        print(f' ok  ({len(lote) - vacios} con datos, {vacios} vacios)')
        time.sleep(PAUSA)

    if 'SPY' not in series:
        print('\n[X] No se pudo bajar SPY, que es el benchmark de F2/F3/F4.')
        print('    Sin SPY el snapshot no sirve. No se escribe nada.')
        sys.exit(1)

    # ── Eje de fechas compartido ────────────────────────────────────────────
    # Se usa el de SPY: cotiza todos los dias habiles del mercado y es el
    # calendario correcto. Un papel con menos historia queda con `null` al
    # principio, que es la verdad — no cotizaba.
    eje = [d.strftime('%Y-%m-%d') for d in series['SPY'].index]
    pos = {f: i for i, f in enumerate(eje)}

    salida_series, cobertura = {}, {}
    for sym, s in series.items():
        fila = [None] * len(eje)
        n = 0
        for fecha, valor in s.items():
            i = pos.get(fecha.strftime('%Y-%m-%d'))
            if i is not None and pd.notna(valor):
                fila[i] = round(float(valor), 4)
                n += 1
        if not n:
            fallidos.append(sym)
            continue
        primero = next((i for i, v in enumerate(fila) if v is not None), 0)
        salida_series[sym] = fila
        cobertura[sym] = {'desde': primero, 'puntos': n}

    payload = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'yfinance': yf.__version__,
        'desde': desde,
        'anios': anios,
        'ajustado': True,
        '_nota_ajuste': (
            'Precios ajustados por dividendos y splits (auto_adjust=True). '
            'Twelve Data devuelve el cierre crudo, asi que los retornos '
            'calculados con este archivo NO coinciden exactamente con los de '
            'la fuente vieja. Comparar antes de reemplazarla.'),
        '_nota_nulos': (
            'null = ese dia el papel no cotizaba. Saltearlos al calcular '
            'retornos; rellenarlos inventa un retorno de 0% que baja la '
            'volatilidad artificialmente.'),
        'n_simbolos': len(salida_series),
        'n_fechas': len(eje),
        'fechas': eje,
        'series': salida_series,
        'cobertura': cobertura,
    }

    data_dir.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    mb = salida.stat().st_size / 1e6

    print(f'\n[OK] {len(salida_series)} simbolos x {len(eje)} fechas')
    print(f'     {salida}  ({mb:.1f} MB)')
    if fallidos:
        unicos = sorted(set(fallidos))
        print(f'     Sin datos: {len(unicos)} -> {" ".join(unicos[:20])}'
              + (' ...' if len(unicos) > 20 else ''))
    cortos = [s for s, c in cobertura.items() if c['puntos'] < len(eje) * 0.5]
    if cortos:
        print(f'     Con menos de la mitad del historial ({len(cortos)}): '
              f'{" ".join(sorted(cortos)[:15])}')
        print('     (normal en papeles que salieron a bolsa hace poco)')
    print(f'     {time.time() - t0:.0f}s')
    print('\nTodavia NO lo usa nadie: el screener sigue con Twelve Data.')
    print('Siguiente paso: comparar las dos fuentes antes de cambiar.')
    print('   python fetch_historico.py --solo AAPL MSFT KO XOM JPM')


if __name__ == '__main__':
    main()
