# -*- coding: utf-8 -*-
"""MEDIR EL PAYLOAD — la herramienta que faltaba.

POR QUE EXISTE (02/09/2026)
---------------------------
El estimador de costo se quedo corto CINCO veces en cuatro dias. Cada vez fue
el mismo mecanismo: se agrego un bloque al payload, nadie volvio a medir, y la
guarda de `test_tesis_cartera.py` siguio pasando en verde porque sus numeros
viejos eran MAS BAJOS que la realidad nueva.

La medicion se hacia a mano, en una sesion, y despues se perdia. Este archivo
la vuelve reproducible: se corre, imprime la tabla, y de ahi salen los dos
numeros de `estimar_cartera()` y el diccionario `MEDIDO` de la prueba.

    python test/medir_payload.py

NO GASTA UN SOLO TOKEN. Arma el payload y lo mide; no llama a nadie.
"""
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'api'))
sys.path.insert(0, RAIZ)
import informe as I                                          # noqa: E402

# 4 caracteres por token es la regla que usa el proyecto entero (incluido
# `tokens_reglas`). Se deja en una constante para que quien la discuta la
# cambie en un solo lugar.
CHARS_POR_TOKEN = 4

SECTORES = ['Technology', 'Financials', 'Healthcare', 'Consumer Staples',
            'Consumer Discretionary', 'Industrials', 'Energy', 'Materials',
            'Utilities', 'Real Estate', 'Communication Services']


def posicion(i):
    """Una posicion ACCIONABLE: es la forma cara, y es la que hay que medir.

    Las que estan en orden viajan comprimidas. Medir con esas de mas daria un
    numero optimista, que es justo el error que este archivo viene a evitar."""
    return {
        'ticker': f'TCK{i}', 'nombre': f'Empresa Numero {i} Incorporated',
        'sector': SECTORES[i % len(SECTORES)], 'clase': 'core',
        'puntaje_fundamental': 60 + i % 30, 'afinidad_objetivo': 55 + i % 40,
        'banderas_altas': ['deuda alta'] if i % 3 == 0 else [],
        'metricas_usadas': '6/6', 'reemplazos': ['ndEbitda por de'] if i % 4 == 0 else [],
        'peso_pct': round(100 / max(1, i + 6), 1), 'tope_pct': 12,
        'estado': 'sobre' if i % 3 == 0 else 'ok',
        'exceso_pct': 2.4 if i % 3 == 0 else None,
        'exceso_usd': 1180 if i % 3 == 0 else None,
        'acciones': 40 + i, 'ganancia_pct': round(-12 + i * 3.4, 1),
        'accion_calculada': 'recortar' if i % 3 == 0 else 'mantener',
        'toma_ganancia': i % 5 == 0, 'beta': round(0.7 + (i % 9) * 0.18, 2),
        'volatilidad_pct': round(18 + (i % 11) * 1.7, 1),
        'aporte_al_riesgo_pct': round(3 + (i % 13) * 1.9, 1),
        'correlacion_media_con_la_cartera': round(0.1 + (i % 7) * 0.06, 2),
        'peso_objetivo_pct': round(100 / max(1, i + 8), 1),
        'en_orden': False,
    }


def candidato(i):
    return {
        'ticker': f'CND{i}', 'nombre': f'Candidata {i} Corporation',
        'sector': SECTORES[i % len(SECTORES)], 'puntaje': 55 + i % 40,
        'metricas': '6/6', 'beta': round(0.5 + (i % 9) * 0.17, 2),
        'defensivo': i % 3 == 0, 'sector_nuevo': i % 4 == 0,
        'volatilidad_pct': round(15 + (i % 10) * 1.4, 1),
        'correlacion_media_con_la_cartera': round(0.05 + (i % 8) * 0.07, 2),
        'delta_volatilidad_cartera': round(-4 + (i % 9) * 0.6, 2),
        'peso_si_entra_pct': round(4 + (i % 5) * 0.8, 1),
        'volatilidad_si_entra_pct': round(17 + (i % 6) * 0.9, 1),
        'mejora_vs_plan_pts': round((i % 7) * 0.45, 2),
    }


def payload(n):
    """Un payload con TODOS los bloques puestos. El caso caro, no el promedio."""
    pos = [posicion(i) for i in range(n)]
    secs = []
    for j, s in enumerate(sorted({p['sector'] for p in pos})):
        secs.append({'sector': s, 'pct': round(40 - j * 4.5, 1), 'tope': 35,
                     'denominador': 'valor de la cartera',
                     'excede': j == 0, 'exceso_usd': 2990 if j == 0 else None})
    movs = [{'ticker': p['ticker'], 'movimiento': 'recortar', 'de_pct': p['peso_pct'],
             'a_pct': p['peso_pct'] - 2, 'delta_pp': -2.0, 'monto_usd': 980,
             'acciones': 6, 'aporte_al_riesgo_pct': 9.1,
             'limitado_por_tope': False, 'refuerzo_en_sector_al_tope': False}
            for p in pos if p['accion_calculada'] == 'recortar']
    menu = [{'ticker': f'CND{i}', 'nombre': f'Candidata {i} Corporation',
             'sector': SECTORES[i], 'puntaje': 78, 'metricas': '6/6',
             'beta': 0.62, 'defensivo': True, 'entra_con_pct': 5.4,
             'volatilidad_resultante_pct': 16.8, 'mejor_que_el_plan_en_puntos': 1.9,
             'correlacion_con_la_cartera': -0.08} for i in range(3)]
    return {
        'perfil': 'moderado', 'objetivo': 'equilibrado', 'horizonte': 'medio',
        'cartera': {'valor_total_usd': 48200, 'cobertura_analizada_pct': 100,
                    'es_parcial': False, 'renta_variable_pct': 100,
                    'tope_renta_variable_pct': 70, 'resto': []},
        'topes': {'por_posicion': 12, 'por_sector': 35, 'equiponderado': round(100 / n, 1)},
        'estres': {'peor_escenario': 'Caida tipo 2022', 'caida_pct': -22.4,
                   'caida_usd': -10800},
        'industrias': {'disponible': True, 'cobertura_pct': 100, 'sin_dato': [],
                       'concentradas': [{'industria': 'Banks - Diversified',
                                         'sector': 'Financials', 'pct': 22.5,
                                         'denominador': 'valor de la cartera',
                                         'tickers': ['TCK1', 'TCK2']}]},
        'sectores': secs,
        'posiciones': pos,
        'candidatos': [candidato(i) for i in range(min(40, 6 + n * 2))],
        'riesgo': {
            'volatilidad_cartera_pct': 24.6,
            'volatilidad_si_se_llega_al_objetivo_pct': 19.2,
            'ventana_dias': 756, 'cobertura_del_calculo_pct': 100,
            'posiciones_sin_datos': [], 'topes_insuficientes': False,
            'benchmark': {'simbolo': 'SPY', 'retorno_cartera_pct': 61.2,
                          'retorno_benchmark_pct': 44.8, 'exceso_pct': 16.4,
                          'volatilidad_cartera_pct': 24.6,
                          'volatilidad_benchmark_pct': 17.1,
                          'beta_vs_benchmark': 1.24,
                          'correlacion_vs_benchmark': 0.86},
            'grupos_limitantes': [{'grupo': 'Technology', 'tope_pct': 35}],
            'pares_que_son_una_apuesta': [
                {'a': 'TCK0', 'b': 'TCK1', 'correlacion': 0.78, 'peso_conjunto_pct': 21.4}],
        },
        'plan': {
            'umbral_pp': 1.0, 'menu_por_sector': menu,
            'refuerzo_interno_bloqueado': False, 'entradas_nuevas': [],
            'volatilidad_actual_pct': 24.6, 'volatilidad_si_se_ejecuta_pct': 19.2,
            'mejora_puntos': 5.4, 'comprar_usd': 4100, 'vender_usd': 4100,
            'movimientos': movs,
        },
    }


def medir(n):
    d = I._resumen_cartera(payload(n))
    js = json.dumps(d, ensure_ascii=False, separators=(',', ':'))
    return len(js) // CHARS_POR_TOKEN, len(d.get('candidatos') or [])


if __name__ == '__main__':
    print('=' * 68)
    print('  PAYLOAD REAL vs ESTIMADOR   (0 tokens gastados)')
    print('=' * 68)
    print(f'  {"pos":>4}  {"real":>7}  {"estimado":>9}  {"holgura":>8}  cand')
    medido = {}
    for n in (3, 5, 10, 15, 20, 25):
        real, ncand = medir(n)
        est = I.estimar_cartera(n, 'anthropic')['tokens_estimados']['entrada']
        medido[n] = real
        h = f'{round((est - real) / real * 100):+d}%'
        marca = '  <-- SUBESTIMA' if est < real else ''
        print(f'  {n:>4}  {real:>7}  {est:>9}  {h:>8}  {ncand:>4}{marca}')
    print()
    print(f'  MEDIDO = {medido}')
    print(f'  prompt de la decision: {len(I.SISTEMA_CARTERA) // 4} tokens')
    print(f'  prompt del cliente:    {len(I.SISTEMA_CLIENTE) // 4} tokens')
