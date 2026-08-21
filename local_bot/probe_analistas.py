#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sonda de viabilidad — Informe avanzado
=======================================

Objetivo: contestar con datos, no con suposiciones, dos preguntas:

  A) ¿yfinance alcanza para el "consenso de analistas" (recomendacion,
     cantidad de analistas, precio objetivo) sin necesidad de fuente externa?

  B) ¿yfinance alcanza para el historico (revenue / EPS / CAGR) que necesita
     el bloque de crecimiento del informe? ¿Cuantos anios devuelve?

Corre desde tu PC (Windows), igual que fetch_fundamentals.py. No corre en
Vercel ni en la VM de Claude: Yahoo bloquea IPs de datacenter.

Uso:
    cd local_bot
    python probe_analistas.py

Genera:
    local_bot/probe_analistas_out.json   <- pasame este archivo
y ademas imprime un resumen legible en consola.

Requisitos: yfinance (ya lo tenes instalado para el bot de fundamentales)
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print("[X] Falta yfinance. Instalalo con: pip install yfinance")
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    print("[X] Falta pandas. Instalalo con: pip install pandas")
    sys.exit(1)


# Muestra chica y variada: distintos sectores y distintos niveles de cobertura
# de analistas, para ver si la cobertura de yfinance es pareja o desigual.
TICKERS = [
    "AAPL",   # Technology - mega cap, maxima cobertura
    "MSFT",   # Technology - mega cap
    "CAT",    # Industrials
    "AMD",    # Technology - semis
    "LRCX",   # Technology - semis equipment
    "MO",     # Consumer Staples - value / dividendo
    "XOM",    # Energy
    "JPM",    # Financials
    "UNH",    # Healthcare
    "NEE",    # Utilities - baja cobertura relativa
]

# Campos de .info que ya viajan en la MISMA llamada que hace fetch_fundamentals.py.
# Si estos alcanzan, el costo marginal de sumar consenso al snapshot es CERO
# llamadas extra.
INFO_CONSENSO = [
    "recommendationKey",        # 'buy' / 'hold' / 'strong_buy' ...
    "recommendationMean",       # 1.0 = strong buy ... 5.0 = strong sell
    "numberOfAnalystOpinions",  # cuantos analistas cubren
    "targetMeanPrice",
    "targetMedianPrice",
    "targetHighPrice",
    "targetLowPrice",
    "currentPrice",
    "trailingEps",
    "forwardEps",
    "earningsGrowth",
    "revenueGrowth",
]


def jsonable(obj):
    """Convierte DataFrames / Series / Timestamps a algo serializable."""
    if obj is None:
        return None
    if isinstance(obj, pd.DataFrame):
        if obj.empty:
            return {"__empty__": True}
        df = obj.copy()
        df.index = [str(i) for i in df.index]
        df.columns = [str(c) for c in df.columns]
        return json.loads(df.to_json(orient="index", date_format="iso"))
    if isinstance(obj, pd.Series):
        return {str(k): (None if pd.isna(v) else v) for k, v in obj.items()}
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat()
    try:
        json.dumps(obj)
        return obj
    except (TypeError, ValueError):
        return str(obj)


def try_get(label, fn, errors):
    """Ejecuta fn() y registra el error en vez de romper la corrida."""
    try:
        return jsonable(fn())
    except Exception as e:
        errors.append(f"{label}: {type(e).__name__}: {e}")
        return {"__error__": f"{type(e).__name__}: {e}"}


def serie_anual(df, filas_posibles):
    """Del income_stmt (columnas = fechas de cierre anual), extrae la primera
    fila que matchee y la devuelve ordenada del anio mas viejo al mas nuevo."""
    if not isinstance(df, pd.DataFrame) or df.empty:
        return {}
    idx = {str(i).strip().lower(): i for i in df.index}
    for cand in filas_posibles:
        key = cand.strip().lower()
        if key in idx:
            fila = df.loc[idx[key]]
            out = {}
            for col in sorted(df.columns):
                val = fila[col]
                if pd.notna(val):
                    out[str(col)[:10]] = float(val)
            return out
    return {}


def cagr(serie):
    """CAGR entre el primer y el ultimo valor de la serie anual."""
    if not serie or len(serie) < 2:
        return None
    anios = sorted(serie.keys())
    v0, v1 = serie[anios[0]], serie[anios[-1]]
    n = len(anios) - 1
    if v0 is None or v1 is None or v0 <= 0 or v1 <= 0 or n <= 0:
        return None
    return round(((v1 / v0) ** (1.0 / n) - 1.0) * 100, 2)


def probe(sym):
    t0 = time.time()
    tk = yf.Ticker(sym)
    errors = []
    r = {"symbol": sym}

    # --- A) consenso ---------------------------------------------------
    info = {}
    try:
        raw = tk.info
        info = {k: raw.get(k) for k in INFO_CONSENSO}
    except Exception as e:
        errors.append(f".info: {type(e).__name__}: {e}")
    r["info_consenso"] = jsonable(info)

    # upside implicito del precio objetivo medio
    px, tgt = info.get("currentPrice"), info.get("targetMeanPrice")
    r["upside_pct"] = round((tgt / px - 1) * 100, 2) if px and tgt else None

    r["recommendations"] = try_get("recommendations", lambda: tk.recommendations, errors)
    r["recommendations_summary"] = try_get(
        "recommendations_summary", lambda: tk.recommendations_summary, errors)
    r["analyst_price_targets"] = try_get(
        "analyst_price_targets", lambda: tk.analyst_price_targets, errors)

    # --- forward / guidance-ish -----------------------------------------
    r["earnings_estimate"] = try_get("earnings_estimate", lambda: tk.earnings_estimate, errors)
    r["revenue_estimate"] = try_get("revenue_estimate", lambda: tk.revenue_estimate, errors)
    r["growth_estimates"] = try_get("growth_estimates", lambda: tk.growth_estimates, errors)
    r["eps_trend"] = try_get("eps_trend", lambda: tk.eps_trend, errors)
    r["eps_revisions"] = try_get("eps_revisions", lambda: tk.eps_revisions, errors)

    # --- sentimiento (nice to have) --------------------------------------
    try:
        ud = tk.upgrades_downgrades
        if isinstance(ud, pd.DataFrame) and not ud.empty:
            r["upgrades_downgrades_ultimos5"] = jsonable(ud.head(5))
            r["upgrades_downgrades_filas"] = int(len(ud))
        else:
            r["upgrades_downgrades_ultimos5"] = {"__empty__": True}
            r["upgrades_downgrades_filas"] = 0
    except Exception as e:
        errors.append(f"upgrades_downgrades: {type(e).__name__}: {e}")
        r["upgrades_downgrades_ultimos5"] = {"__error__": str(e)}

    # --- B) historico para CAGR ------------------------------------------
    hist = {}
    try:
        stmt = tk.income_stmt
        if isinstance(stmt, pd.DataFrame) and not stmt.empty:
            hist["anios_disponibles"] = len(stmt.columns)
            hist["fechas"] = [str(c)[:10] for c in sorted(stmt.columns)]
            hist["filas_disponibles"] = [str(i) for i in stmt.index]
            rev = serie_anual(stmt, ["Total Revenue", "Operating Revenue"])
            eps = serie_anual(stmt, ["Diluted EPS", "Basic EPS"])
            ni = serie_anual(stmt, ["Net Income", "Net Income Common Stockholders"])
            hist["revenue"] = rev
            hist["eps_diluido"] = eps
            hist["net_income"] = ni
            hist["cagr_revenue_pct"] = cagr(rev)
            hist["cagr_eps_pct"] = cagr(eps)
            hist["cagr_net_income_pct"] = cagr(ni)
        else:
            hist["__empty__"] = True
    except Exception as e:
        errors.append(f"income_stmt: {type(e).__name__}: {e}")
        hist["__error__"] = str(e)
    r["historico"] = hist

    r["errores"] = errors
    r["segundos"] = round(time.time() - t0, 2)
    return r


def resumen(res):
    print("\n" + "=" * 78)
    print("RESUMEN — A) CONSENSO DE ANALISTAS (fuente: .info, misma llamada que el bot)")
    print("=" * 78)
    hdr = f"{'TICK':<6}{'rec':<12}{'mean':>6}{'#an':>5}{'precio':>10}{'target':>10}{'upside':>9}"
    print(hdr); print("-" * len(hdr))
    for r in res:
        i = r.get("info_consenso") or {}
        print(f"{r['symbol']:<6}"
              f"{str(i.get('recommendationKey') or '-'):<12}"
              f"{(i.get('recommendationMean') if i.get('recommendationMean') is not None else float('nan')):>6.2f}"
              f"{str(i.get('numberOfAnalystOpinions') or '-'):>5}"
              f"{(i.get('currentPrice') or float('nan')):>10.2f}"
              f"{(i.get('targetMeanPrice') or float('nan')):>10.2f}"
              f"{(r.get('upside_pct') if r.get('upside_pct') is not None else float('nan')):>8.1f}%")

    print("\n" + "=" * 78)
    print("RESUMEN — endpoints dedicados (llamada EXTRA por ticker)")
    print("=" * 78)
    hdr2 = f"{'TICK':<6}{'recommend.':<12}{'price_targets':<15}{'earn_est':<11}{'growth_est':<12}{'up/down':<9}"
    print(hdr2); print("-" * len(hdr2))
    for r in res:
        def st(k):
            v = r.get(k)
            if v is None: return "None"
            if isinstance(v, dict):
                if "__error__" in v: return "ERROR"
                if "__empty__" in v: return "vacio"
                return f"OK({len(v)})"
            return "OK"
        print(f"{r['symbol']:<6}{st('recommendations'):<12}{st('analyst_price_targets'):<15}"
              f"{st('earnings_estimate'):<11}{st('growth_estimates'):<12}"
              f"{str(r.get('upgrades_downgrades_filas', '-')):<9}")

    print("\n" + "=" * 78)
    print("RESUMEN — B) HISTORICO PARA CAGR (income_stmt anual)")
    print("=" * 78)
    hdr3 = f"{'TICK':<6}{'anios':>6}{'rev pts':>9}{'eps pts':>9}{'CAGR rev':>10}{'CAGR eps':>10}"
    print(hdr3); print("-" * len(hdr3))
    for r in res:
        h = r.get("historico") or {}
        print(f"{r['symbol']:<6}"
              f"{str(h.get('anios_disponibles', '-')):>6}"
              f"{len(h.get('revenue') or {}):>9}"
              f"{len(h.get('eps_diluido') or {}):>9}"
              f"{str(h.get('cagr_revenue_pct', '-')):>10}"
              f"{str(h.get('cagr_eps_pct', '-')):>10}")

    errs = [(r["symbol"], e) for r in res for e in r.get("errores", [])]
    if errs:
        print("\n--- ERRORES (%d) ---" % len(errs))
        for s, e in errs[:40]:
            print(f"  {s}: {e}")

    tot = sum(r.get("segundos", 0) for r in res)
    print(f"\nTiempo: {tot:.1f}s para {len(res)} tickers "
          f"({tot/max(len(res),1):.1f}s c/u -> ~{tot/max(len(res),1)*504/60:.0f} min para 504)")


def main():
    syms = [s.upper() for s in sys.argv[1:]] or TICKERS
    print(f"yfinance {yf.__version__} | python {sys.version.split()[0]}")
    print(f"Sondeando {len(syms)} tickers: {', '.join(syms)}\n")

    res = []
    for i, s in enumerate(syms, 1):
        print(f"  [{i}/{len(syms)}] {s} ...", end="", flush=True)
        r = probe(s)
        print(f" {r['segundos']}s  ({len(r['errores'])} errores)")
        res.append(r)
        time.sleep(0.5)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "yfinance": yf.__version__,
        "python": sys.version.split()[0],
        "tickers": syms,
        "resultados": res,
    }
    out_path = Path(__file__).resolve().parent / "probe_analistas_out.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    resumen(res)
    print(f"\n[OK] Detalle completo guardado en:\n   {out_path}")
    print("\nPasame ese archivo (o dejalo ahi, que lo leo de la carpeta del proyecto).")


if __name__ == "__main__":
    main()
