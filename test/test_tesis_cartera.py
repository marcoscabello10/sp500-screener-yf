#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prueba de la TESIS DE CARTERA (action=tesis_cartera).

Verifica, sin gastar un solo token:

  1. Que el tope de salida ESCALE con la cantidad de posiciones. Con 2000
     fijos, una cartera de 10 posiciones se cortaba a la mitad.
  2. Que el bloque de reglas viaje con cache_control y sea IDENTICO entre
     llamadas: si se le cuela algo variable, el cache deja de servir y nadie
     se entera hasta ver la factura.
  3. Que NINGUN camino gratuito gaste, y que elegir un proveedor no toque al
     otro (la misma regla que ya rige la tesis individual).
  4. Que la validacion de la respuesta encuentre lo que el prompt no puede
     garantizar: tickers inventados, secciones faltantes, numeros que
     contradicen los que se le dieron.
  5. Que un error diga si la llamada se cobro o no, sin mentir.

Correr:  python test/test_tesis_cartera.py
"""
import importlib.util
import io
import json
import sys
import urllib.error
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('inf', str(RAIZ / 'api' / 'informe.py'))
I = importlib.util.module_from_spec(spec)
spec.loader.exec_module(I)

LLAMADAS = []
RESPUESTA = {'modo': 'normal'}

TEXTO_OK = """## 1. Qué hacer
Recortar AAPL por toma de ganancia y llevar el excedente a KO.

## 2. Cómo está la cartera
Technology pesa 41% contra un tope de 35%.

## 3. Posición por posición
AAPL: buena empresa, posición sobredimensionada. Acción: recortar por toma de
ganancia. Confianza alta.
KO: sólida, por debajo del tope. Acción: reforzar. Confianza alta.

## 4. Rotaciones
Ninguna que valga la pena todavía.

## 5. Para el cliente
Conviene achicar un poco la posición más grande y repartirla."""


def falso_post(url, headers, cuerpo, timeout=None):
    LLAMADAS.append({'url': url, 'headers': dict(headers), 'cuerpo': cuerpo,
                     'timeout': timeout})
    texto = {'normal': TEXTO_OK,
             'inventa': RESPUESTA.get('texto', ''),
             'sin_texto': ''}[RESPUESTA['modo']]
    if 'anthropic' in url:
        if RESPUESTA['modo'] == 'sin_texto':
            return {'content': [{'type': 'thinking', 'thinking': '...'}],
                    'stop_reason': 'max_tokens', 'model': 'claude-sonnet-5',
                    'usage': {'input_tokens': 2100, 'output_tokens': 3000}}
        return {'content': [{'type': 'text', 'text': texto}],
                'usage': {'input_tokens': 2100, 'output_tokens': 900,
                          'cache_read_input_tokens': 1300}}
    return {'choices': [{'message': {'content': texto}}],
            'usage': {'prompt_tokens': 2100, 'completion_tokens': 900,
                      'prompt_tokens_details': {'cached_tokens': 1300}}}


I._post_json = falso_post

fallos = []
def chequear(cond, msg):
    if not cond:
        fallos.append(msg)


def limpiar(**env):
    LLAMADAS.clear()
    for k in ('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'MODELO_ANTHROPIC', 'MODELO_OPENAI'):
        I.os.environ.pop(k, None)
    I.os.environ.update(env)


def cartera(n=2):
    """Un payload con la forma que arma el navegador."""
    base = [
        {'ticker': 'AAPL', 'nombre': 'Apple', 'sector': 'Technology',
         'clase': 'core', 'puntaje_fundamental': 72, 'metricas_usadas': '6/6',
         'reemplazos': [], 'peso_pct': 14.2, 'tope_pct': 12, 'estado': 'sobre',
         'exceso_pct': 2.2, 'exceso_usd': 1060, 'ganancia_pct': 34.1,
         'accion_calculada': 'recortar', 'toma_ganancia': True},
        {'ticker': 'KO', 'nombre': 'Coca-Cola', 'sector': 'Consumer Staples',
         'clase': 'core', 'puntaje_fundamental': 61, 'metricas_usadas': '6/6',
         'reemplazos': [], 'peso_pct': 6.1, 'tope_pct': 12, 'estado': 'bajo',
         'exceso_pct': None, 'exceso_usd': None, 'ganancia_pct': 4.0,
         'accion_calculada': 'reforzar', 'toma_ganancia': False},
    ]
    extra = [dict(base[1], ticker=f'X{i}', nombre=f'Papel {i}') for i in range(n - 2)]
    return {
        'perfil': 'moderado', 'objetivo': 'equilibrado', 'horizonte': 'medio',
        'cartera': {'valor_total_usd': 48200, 'cobertura_analizada_pct': 100},
        'topes': {'por_posicion': 12, 'por_sector': 35},
        'estres': {'caida_estimada_pct': -22.4},
        'sectores': [{'sector': 'Technology', 'pct': 41.2, 'tope': 35,
                      'excede': True, 'exceso_usd': 2990}],
        'posiciones': base + extra,
        'candidatos': [{'ticker': 'NEM', 'sector': 'Materials', 'puntaje': 83,
                        'metricas': '6/6'}],
    }


print('=' * 74)

# ── 1. El tope de salida escala ─────────────────────────────────────────────
t2, t10, t40 = (I.max_tokens_cartera(n) for n in (2, 10, 40))
chequear(t10 > t2, 'el tope tiene que crecer con las posiciones')
chequear(t10 >= 2500, f'con 10 posiciones el tope es {t10}: se queda corto')
chequear(t40 <= I.MAX_TOKENS_CARTERA_TOPE, 'el tope tiene que estar acotado')
chequear(I.max_tokens_cartera(0) >= I.MAX_TOKENS_CARTERA_BASE,
         'sin posiciones deberia dar al menos la base')
chequear(I.max_tokens_cartera(None) >= I.MAX_TOKENS_CARTERA_BASE,
         'None no deberia romper')
print(f'  tope de salida      -> 2 pos: {t2} · 10 pos: {t10} · 40 pos: {t40}')

# ── 2. El bloque de reglas: cacheado e identico ─────────────────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
RESPUESTA['modo'] = 'normal'
r1, e1 = I.generar_tesis_cartera(cartera(2), 'anthropic')
chequear(e1 is None, f'la llamada base deberia andar -> {e1}')
c1 = LLAMADAS[-1]['cuerpo']
sistemas = c1.get('system')
chequear(isinstance(sistemas, list), 'el system tiene que ser lista de bloques')
chequear(sistemas[0].get('cache_control', {}).get('type') == 'ephemeral',
         'al bloque de reglas le falta cache_control')
chequear('NO recalcules' in sistemas[0]['text'],
         'el bloque de reglas no trae la prohibicion de recalcular')

limpiar(ANTHROPIC_API_KEY='sk-ant-x')
I.generar_tesis_cartera(cartera(5), 'anthropic')
c2 = LLAMADAS[-1]['cuerpo']
chequear(c2['system'][0]['text'] == sistemas[0]['text'],
         'EL BLOQUE DE REGLAS CAMBIO entre dos carteras: el cache no sirve')
chequear(c2['max_tokens'] > c1['max_tokens'],
         'el tope tiene que crecer con la cartera mas grande')
# Y los datos NO pueden estar en el system, o invalidan el cache.
chequear('AAPL' not in sistemas[0]['text'],
         'hay datos de la cartera dentro del bloque cacheado')
chequear('AAPL' in c1['messages'][0]['content'],
         'los datos tienen que ir en el mensaje del usuario')
print(f'  bloque de reglas    -> cacheado, identico entre carteras '
      f'({len(sistemas[0]["text"])} chars)')

# ── 3. Nada gasta de mas, y un proveedor no toca al otro ────────────────────
limpiar()
r, e = I.generar_tesis_cartera(cartera(), 'anthropic')
chequear(r is None and e and not LLAMADAS, 'sin clave NO puede llamar a la red')

limpiar(ANTHROPIC_API_KEY='sk-ant-x')
I.generar_tesis_cartera(cartera(), 'anthropic')
chequear(all('anthropic' in c['url'] for c in LLAMADAS),
         'SE FUE A OTRO PROVEEDOR')

limpiar(OPENAI_API_KEY='sk-oai-x')
r, e = I.generar_tesis_cartera(cartera(), 'anthropic')
chequear(r is None and not LLAMADAS,
         'con solo openai cargado, pedir anthropic NO puede caer a openai')

limpiar(ANTHROPIC_API_KEY='sk-ant-x', OPENAI_API_KEY='sk-oai-x')
I.generar_tesis_cartera(cartera(), 'openai')
chequear(len(LLAMADAS) == 1 and 'openai' in LLAMADAS[0]['url'],
         'pedir openai teniendo las dos claves toco a anthropic')

limpiar(ANTHROPIC_API_KEY='sk-ant-x')
r, e = I.generar_tesis_cartera({'posiciones': []}, 'anthropic')
chequear(r is None and not LLAMADAS, 'una cartera vacia NO deberia gastar')
r, e = I.generar_tesis_cartera(cartera(), 'inventado')
chequear(r is None and not LLAMADAS, 'un proveedor inventado NO deberia gastar')
print(f'  gasto controlado    -> sin clave, cartera vacia y proveedor invalido '
      f'no llaman a nadie')

# ── 4. El timeout se respeta (Vercel corta a los 60) ───────────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
I.generar_tesis_cartera(cartera(), 'anthropic')
chequear(LLAMADAS[-1]['timeout'] is not None and LLAMADAS[-1]['timeout'] < 60,
         f'el timeout ({LLAMADAS[-1]["timeout"]}) tiene que ser < 60: Vercel '
         f'mata la funcion a los 60 y el usuario veria un 504 habiendo pagado')
print(f'  timeout             -> {LLAMADAS[-1]["timeout"]}s (Vercel corta a los 60)')

# ── 5. La validacion encuentra lo que el prompt no garantiza ────────────────
datos = I._resumen_cartera(cartera(2))

av = I.validar_respuesta_cartera(TEXTO_OK, datos)
chequear(not av, f'la respuesta buena no deberia tener avisos -> {av}')

av = I.validar_respuesta_cartera(TEXTO_OK.replace('KO', 'TSLA'), datos)
chequear(any('TSLA' in a for a in av), f'no detecto el ticker inventado -> {av}')
chequear(any('KO' in a and 'menciona' in a for a in av),
         f'no detecto la posicion sin mencionar -> {av}')

av = I.validar_respuesta_cartera(
    TEXTO_OK.replace('## 5. Para el cliente', '## 5. Cierre'), datos)
chequear(any('Para el cliente' in a for a in av),
         f'no detecto la seccion faltante -> {av}')

sin_motivo = TEXTO_OK.replace('toma de ganancia', 'ajuste').replace(
    'toma de\nganancia', 'ajuste')
av = I.validar_respuesta_cartera(sin_motivo, datos)
chequear(any('motivos de recorte' in a for a in av),
         f'no detecto que no uso ninguno de los cinco motivos -> {av}')

# Un peso contradicho: se le dijo 14,2% y el texto dice 9,5%.
av = I.validar_respuesta_cartera(
    TEXTO_OK.replace('AAPL: buena empresa', 'AAPL pesa 9,5% de la cartera'), datos)
chequear(any('9.5' in a or '9,5' in a for a in av),
         f'no detecto el peso contradicho -> {av}')
# Pero un numero que SI se le dio no tiene que marcarse.
av = I.validar_respuesta_cartera(
    TEXTO_OK.replace('AAPL: buena empresa', 'AAPL pesa 14,2% contra un tope de 12%'),
    datos)
chequear(not any('14' in a for a in av),
         f'marco como error un numero que SI se le dio -> {av}')
print('  validacion          -> detecta tickers inventados, secciones y numeros '
      'contradichos')

# ── 6. Un error no puede mentir sobre si se cobro ───────────────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
RESPUESTA['modo'] = 'sin_texto'
r, e = I.generar_tesis_cartera(cartera(10), 'anthropic')
chequear(r is None and e, 'sin texto no deberia devolver resultado')
chequear('cobro' in (e or '').lower(),
         f'el error tiene que avisar que la llamada se cobro -> {e!r}')
chequear('max_tokens' in (e or '') or 'tope de salida' in (e or ''),
         f'el error tiene que nombrar el corte por tope -> {e!r}')
chequear('thinking' in (e or ''), f'tiene que decir que tipo de bloque vino -> {e!r}')
print(f'  respuesta sin texto -> el error explica y no miente sobre el costo')
RESPUESTA['modo'] = 'normal'

# ── 7. El resultado trae lo que hace falta para decidir ─────────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
res, err = I.generar_tesis_cartera(cartera(3), 'anthropic')
chequear(err is None, f'{err}')
for k in ('texto', 'avisos', 'proveedor', 'modelo', 'tokens',
          'costo_estimado_usd', 'n_posiciones'):
    chequear(k in res, f'al resultado le falta {k!r}')
chequear(res['tokens'].get('desde_cache') == 1300,
         'no reporta cuantos tokens vinieron del cache')
chequear(res['tokens'].get('tope_de_salida') == I.max_tokens_cartera(3),
         'no reporta el tope que se uso')
chequear(isinstance(res['costo_estimado_usd'], float) and res['costo_estimado_usd'] > 0,
         f'el costo estimado sale mal -> {res["costo_estimado_usd"]}')
print(f'  resultado           -> {res["n_posiciones"]} posiciones, '
      f'USD {res["costo_estimado_usd"]}, {res["tokens"]["desde_cache"]} tokens '
      f'del cache')

# ── 8. El tope de posiciones se respeta ─────────────────────────────────────
grande = cartera(60)
d = I._resumen_cartera(grande)
chequear(len(d['posiciones']) <= I.MAX_POSICIONES_CARTERA,
         f'no recorto a {I.MAX_POSICIONES_CARTERA} posiciones')
print(f'  cartera grande      -> 60 posiciones se recortan a '
      f'{len(d["posiciones"])}')

# ── 9. 15 posiciones tienen que ENTRAR en los 60s de Vercel ────────────────
# Es el caso que pidio Marcos explicitamente. Con la seccion 3 en prosa no
# entraba ni con 10.
e15 = I.estimar_cartera(15, 'anthropic', 'rapido')
chequear(e15['entra_en_el_limite'],
         f'15 posiciones en modo rapido NO entran: {e15["segundos_estimados"]}s')
chequear(e15['segundos_estimados'] < I.TIMEOUT_CARTERA,
         f'{e15["segundos_estimados"]}s contra un timeout de {I.TIMEOUT_CARTERA}s')
print(f'  15 posiciones       -> {e15["segundos_estimados"]}s en modo rapido '
      f'(limite {I.TIMEOUT_CARTERA}s)')

# El estimador NO puede gastar: es aritmetica, no una llamada.
LLAMADAS.clear()
for n in (1, 15, 40):
    for m in ('rapido', 'profundo'):
        I.estimar_cartera(n, 'anthropic', m)
chequear(not LLAMADAS, 'EL ESTIMADOR LLAMO A LA RED: tiene que ser gratis')
print(f'  estimador           -> {len(LLAMADAS)} llamadas a la red (tiene que ser 0)')

# Y tiene que decir la verdad cuando NO entra.
malo = I.estimar_cartera(40, 'anthropic', 'profundo')
chequear(not malo['entra_en_el_limite'],
         'con 40 posiciones en modo profundo deberia avisar que no entra')

# ── 10. El modo cambia el modelo, y el rapido es mas barato ────────────────
r = I.estimar_cartera(15, 'anthropic', 'rapido')
pf = I.estimar_cartera(15, 'anthropic', 'profundo')
chequear(r['modelo'] != pf['modelo'], 'los dos modos usan el mismo modelo')
chequear(r['costo_estimado_usd'] < pf['costo_estimado_usd'],
         f'el modo rapido tendria que ser mas barato: {r["costo_estimado_usd"]} '
         f'vs {pf["costo_estimado_usd"]}')
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
I.generar_tesis_cartera(cartera(3), 'anthropic', 'profundo')
chequear(LLAMADAS[-1]['cuerpo']['model'] == pf['modelo'],
         f'el modo profundo no uso el modelo que dice el estimador')
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
I.generar_tesis_cartera(cartera(3), 'anthropic')
chequear(LLAMADAS[-1]['cuerpo']['model'] == r['modelo'],
         'el default tendria que ser el modo rapido')
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
res, err = I.generar_tesis_cartera(cartera(3), 'anthropic', 'inventado')
chequear(res is None and not LLAMADAS, 'un modo invalido NO deberia gastar')
print(f'  modos               -> rapido USD {r["costo_estimado_usd"]} · '
      f'profundo USD {pf["costo_estimado_usd"]} (default: rapido)')

# ── 11. El filtro de candidatos ────────────────────────────────────────────
# Los candidatos eran el 45% del payload y se pagaban en cada llamada.
muchos = dict(cartera(6))
muchos['candidatos'] = [
    {'ticker': f'C{i}', 'nombre': f'Candidato numero {i} Corp.',
     'sector': ['Technology', 'Materials', 'Energy', 'Utilities'][i % 4],
     'puntaje': 80, 'metricas': '6/6', 'reemplazos': []} for i in range(49)]
muchos['sectores'] = [
    {'sector': 'Technology', 'pct': 41.2, 'tope': 35, 'excede': True},
    {'sector': 'Materials', 'pct': 8, 'tope': 35, 'excede': False},
    {'sector': 'Energy', 'pct': 6, 'tope': 35, 'excede': False}]
d = I._resumen_cartera(muchos)
chequear(len(d['candidatos']) < 49,
         f'no filtro nada: quedaron {len(d["candidatos"])} de 49')
chequear(all('nombre' not in c for c in d['candidatos']),
         'los candidatos siguen mandando el nombre largo')
tech = [c for c in d['candidatos'] if c['sector'] == 'Technology']
chequear(len(tech) <= 2,
         f'Technology excede su tope: no puede aportar {len(tech)} candidatos '
         f'como destino de plata nueva')
chequear(all(k not in (d['posiciones'][0] or {})
             for k in ('precio_compra', 'cantidad', 'valor_actual')),
         'las posiciones siguen mandando campos que no cambian una decision')
print(f'  filtro de candidatos-> 49 -> {len(d["candidatos"])}, sin nombres largos')

print('=' * 74)
if fallos:
    print(f'  {len(fallos)} FALLAS:')
    for f in fallos:
        print(f'    - {f}')
    sys.exit(1)
print('  El tope escala, el bloque de reglas se cachea, ningun camino gratuito')
print('  gasta, la validacion encuentra lo que el prompt no garantiza, y un')
print('  error nunca miente sobre si la llamada se cobro.')
print('  OK')
