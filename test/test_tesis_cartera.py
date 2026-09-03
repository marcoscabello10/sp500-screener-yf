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
Ninguna que valga la pena todavía."""


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
#
# ⚠️ Esto antes era `'AAPL' not in sistemas[0]['text']`, y el 31/08 dio un
# FALSO POSITIVO: el prompt reescrito trae un antiejemplo —✗ "Vender AMD,
# comprar AAPL y MSFT" (tickers)— que es texto FIJO y no invalida ningun cache.
# La prueba miraba un sintoma (aparece un ticker) en vez de la propiedad
# (el bloque cambia con la cartera).
#
# Ahora se inyecta un ticker centinela que no existe en ningun lado. Si el
# bloque cacheado lo contiene, es porque alguien interpolo datos de la cartera
# adentro de las reglas — que es lo unico que rompe el cache de verdad.
centinela = cartera(3)
centinela['posiciones'][0]['ticker'] = 'ZZQQX'
centinela['posiciones'][0]['nombre'] = 'Centinela de Prueba SA'
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
I.generar_tesis_cartera(centinela, 'anthropic')
bloque_centinela = LLAMADAS[-1]['cuerpo']['system'][0]['text']
chequear('ZZQQX' not in bloque_centinela and 'Centinela' not in bloque_centinela,
         'hay datos de la cartera dentro del bloque cacheado')
chequear(bloque_centinela == sistemas[0]['text'],
         'el bloque de reglas cambio con una cartera distinta: el cache no sirve')
# El ticker SI tiene que estar en el mensaje del usuario, que no se cachea.
chequear('ZZQQX' in LLAMADAS[-1]['cuerpo']['messages'][0]['content'],
         'la cartera no llego en el mensaje del usuario')
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
    TEXTO_OK.replace('## 4. Rotaciones', '## 4. Cierre'), datos)
chequear(any('Rotaciones' in a for a in av),
         f'no detecto la seccion faltante -> {av}')

# ⚠️ Y AL REVES: una seccion "Para el cliente" en ESTA respuesta es plata
# tirada. Ese texto ahora sale de la segunda llamada, con su propio prompt.
# Sin esta guarda, el dia que el modelo la escriba igual nadie se entera: el
# texto se ve bien y se paga dos veces.
av = I.validar_respuesta_cartera(
    TEXTO_OK + '\n\n## 5. Para el cliente\nBla bla.', datos)
chequear(any('Para el cliente' in a for a in av),
         f'no avisa que escribio una seccion que ya no se le pide -> {av}')

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
# ⚠️ EL `nombre` SE FUE OTRA VEZ, Y AHORA SI CORRESPONDE (02/09/2026).
#
# Historia corta, porque este campo entro y salio dos veces y conviene que
# quede escrito: se saco por peso, volvio el 31/08 porque la seccion "Para el
# cliente" necesita nombres de empresa y el modelo no puede deducir "T-Mobile"
# de "TMUS", y se volvio a ir hoy porque esa seccion ya NO sale de esta
# llamada. Los nombres viajan en el bloque de hechos de la segunda.
#
# Medido: son el 5,5% de cada llamada (104 tokens con 5 posiciones, 313 con 25).
chequear(not any('nombre' in c for c in d['candidatos']),
         'los candidatos siguen mandando el nombre de la empresa: la decision '
         'se escribe en tickers y eso es 5,5% de cada llamada')
chequear(not any('nombre' in p for p in d['posiciones']),
         'las posiciones siguen mandando el nombre de la empresa')
tech = [c for c in d['candidatos'] if c['sector'] == 'Technology']
chequear(len(tech) <= 2,
         f'Technology excede su tope: no puede aportar {len(tech)} candidatos '
         f'como destino de plata nueva')
chequear(all(k not in (d['posiciones'][0] or {})
             for k in ('precio_compra', 'cantidad', 'valor_actual')),
         'las posiciones siguen mandando campos que no cambian una decision')
print(f'  filtro de candidatos-> 49 -> {len(d["candidatos"])}, sin nombres largos')

# ── 12. NADA del Motor B se cae en el camino ──────────────────────────────
# `_resumen_cartera` arma el payload clave por clave: una clave que no se nombra
# ahi no llega NUNCA, sin error y sin aviso. Asi se perdieron dos cosas a la
# vez: el bloque `riesgo` entero y los tres campos de riesgo de cada candidato.
# El prompt pedia elegir por correlacion y delta de volatilidad mientras esos
# numeros se tiraban antes de la llamada.
conB = dict(cartera(4))
conB['riesgo'] = {'volatilidad_cartera_pct': 15.9,
                  'volatilidad_si_se_llega_al_objetivo_pct': 12.2,
                  'cobertura_del_calculo_pct': 87.5,
                  'ventana_dias': 756, 'posiciones_sin_datos': ['NEW'],
                  'topes_insuficientes': None}
conB['plan'] = {'umbral_pp': 1.0, 'mejora_puntos': 3.7,
                'comprar_usd': 12540, 'vender_usd': 12480,
                'movimientos': [{'ticker': 'AAPL', 'movimiento': 'vender',
                                 'de_pct': 30.0, 'a_pct': 10.8,
                                 'delta_pp': -19.2, 'monto_usd': -11520,
                                 'acciones': -38}]}
conB['candidatos'] = [
    {'ticker': 'KO', 'nombre': 'Coca-Cola Co.', 'sector': 'Materials',
     'puntaje': 61, 'metricas': '6/6', 'volatilidad_pct': 16.5,
     'correlacion_media_con_la_cartera': 0.06,
     'delta_volatilidad_cartera': -1.8},
    {'ticker': 'MSFT', 'nombre': 'Microsoft', 'sector': 'Materials',
     'puntaje': 78, 'metricas': '6/6', 'volatilidad_pct': 26.1,
     'correlacion_media_con_la_cartera': 0.35,
     'delta_volatilidad_cartera': -0.2}]
conB['sectores'] = [{'sector': 'Materials', 'pct': 8, 'tope': 35,
                     'excede': False}]
d2 = I._resumen_cartera(conB)

chequear(d2.get('riesgo', {}).get('volatilidad_cartera_pct') == 15.9,
         'el bloque `riesgo` no llega al modelo: se calcula y se tira')
chequear(d2.get('plan', {}).get('mejora_puntos') == 3.7,
         'el bloque `plan` no llega al modelo')
chequear(d2['plan']['movimientos'][0]['monto_usd'] == -11520,
         'los montos del plan no llegan enteros')
# ⚠️ EL CONTRATO CAMBIO EL 02/09 CON `_comprimir_candidatos`, y el cambio es
# deliberado: los candidatos que el MENU ya eligio viajan completos —son una
# recomendacion y el modelo tiene que poder justificarla con sus numeros—; los
# demas viajan en formato corto. Medido: 23 candidatos eran 1.472 tokens, el
# 43% del payload, y veinte de ellos eran opciones que el codigo YA descarto.
#
# Lo que NO se puede perder ni en el formato corto es el delta de volatilidad:
# es el unico numero que dice si ese papel mejora ESTA cartera. Sin el, el
# orden vuelve a ser por puntaje fundamental, que fue el error del Motor B.
for c in d2['candidatos']:
    tiene_delta = ('delta_volatilidad_cartera' in c) or ('delta_vol' in c)
    chequear(tiene_delta,
             f'{c["ticker"]}: el delta de volatilidad se cae en el camino')
    chequear({'ticker', 'sector', 'puntaje'} <= set(c),
             f'{c["ticker"]}: le falta algo del formato corto minimo')
# Sin menu, NINGUNO es una recomendacion: todos tienen que ir cortos.
chequear(all('correlacion_media_con_la_cartera' not in c
             for c in d2['candidatos']),
         'sin menu, un candidato descartado viaja completo: son tokens de mas')
# Y con menu, el elegido viaja entero.
conMenu = dict(conB)
conMenu['plan'] = dict(conB['plan'], menu_por_sector=[{'ticker': 'KO'}])
dMenu = I._resumen_cartera(conMenu)
elegido = [c for c in dMenu['candidatos'] if c['ticker'] == 'KO'][0]
chequear('correlacion_media_con_la_cartera' in elegido,
         'el candidato que el menu YA eligio viaja comprimido: el modelo no '
         'puede justificar la recomendacion con sus propios numeros')
# Y el orden: primero el que MAS baja la volatilidad, no el de mejor puntaje.
# Con el orden por puntaje, el modelo elegia MSFT (78) sobre KO (61) — que es
# la decision que la auditoria del Motor B midio como nueve veces peor.
chequear(d2['candidatos'][0]['ticker'] == 'KO',
         f'los candidatos no vienen ordenados por aporte a ESTA cartera: '
         f'primero quedo {d2["candidatos"][0]["ticker"]}')

# Sin Motor B el payload igual tiene que salir, con la marca puesta.
sinB = I._resumen_cartera(dict(cartera(3)))
chequear(sinB['riesgo'] == {'disponible': False},
         'sin Motor B el payload tendria que decirlo explicitamente')
chequear(sinB['plan'] is None, 'sin Motor B no puede haber plan')

# La compuerta general: TODA clave de primer nivel que produce el navegador
# tiene que sobrevivir. Es la unica forma de que el proximo campo nuevo no se
# pierda igual que estos dos.
CLAVES_DEL_NAVEGADOR = {'perfil', 'objetivo', 'horizonte', 'cartera', 'topes',
                        'estres', 'sectores', 'posiciones', 'candidatos',
                        'riesgo', 'plan'}
faltan = CLAVES_DEL_NAVEGADOR - set(d2.keys())
chequear(not faltan, f'estas claves se pierden en _resumen_cartera: {faltan}')
print(f'  Motor B completo    -> riesgo + plan + {len(d2["candidatos"])} '
      f'candidatos con delta, mejor primero')

# ── 14. LOS SECTORES AUSENTES SON EL MEJOR DESTINO, NO EL PEOR ────────────
# El bug que Marcos vio leyendo la salida: "me dice que siga sumando tecnologia
# y no me da opciones mas defensivas". `_filtrar_candidatos` armaba `utiles` a
# partir de los sectores QUE YA ESTAN EN LA CARTERA, asi que un sector donde no
# tenia nada se filtraba ENTERO. Medido sobre su cartera real: de 51 candidatos
# pasaban 10 y desaparecian OCHO sectores completos, incluidos los defensivos.
sec_cartera = [
    {'sector': 'Technology', 'pct': 49.3, 'tope': 43.3, 'excede': True},
    {'sector': 'Industrials', 'pct': 14.9, 'tope': 43.3, 'excede': False},
]
pos_cartera = [
    {'ticker': 'AMD', 'sector': 'Technology', 'estado': 'critico',
     'accion_calculada': 'recortar'},
    {'ticker': 'CAT', 'sector': 'Industrials', 'estado': 'banda',
     'accion_calculada': 'mantener'},
]
cands_todos = []
for sec, ts in (('Technology', ['ZM', 'FSLR', 'MU']),
                ('Industrials', ['HON', 'SNA', 'ASR']),
                ('Consumer Staples', ['MO', 'PG', 'ABEV']),
                ('Utilities', ['SBS', 'NEE', 'KEP']),
                ('Healthcare', ['BMY', 'NVO', 'GSK'])):
    for t in ts:
        cands_todos.append({'ticker': t, 'sector': sec, 'puntaje': 70,
                            'metricas': '6/6', 'beta': 0.4,
                            'defensivo': True, 'sector_nuevo':
                                sec not in ('Technology', 'Industrials')})
filtrados = I._filtrar_candidatos(cands_todos, pos_cartera, sec_cartera)
secs_out = {c['sector'] for c in filtrados}
ausentes = {'Consumer Staples', 'Utilities', 'Healthcare'}
chequear(ausentes <= secs_out,
         f'los sectores donde el cliente NO tiene nada se siguen filtrando: '
         f'faltan {sorted(ausentes - secs_out)}')
chequear(any(c['ticker'] == 'MO' for c in filtrados),
         'MO (Consumer Staples, beta 0,5) no llega al modelo')
# El sector al tope entra igual, pero con menos cupo: solo como reemplazo.
tech = [c for c in filtrados if c['sector'] == 'Technology']
chequear(len(tech) <= I.CANDIDATOS_SECTOR_AL_TOPE,
         f'Technology excede su tope y aporta {len(tech)} candidatos')
nuevos_sec = [c for c in filtrados if c.get('sector_nuevo')]
chequear(all(len([x for x in filtrados if x['sector'] == c['sector']])
             <= I.CANDIDATOS_SECTOR_NUEVO for c in nuevos_sec),
         'un sector nuevo manda mas candidatos que su cupo')
# Y las banderas de riesgo tienen que sobrevivir al filtro.
for k in ('beta', 'defensivo', 'sector_nuevo'):
    chequear(all(k in c for c in filtrados),
             f'"{k}" se cae en el filtro: el modelo no puede elegir por riesgo')
print(f'  sectores ausentes    -> {len(filtrados)} candidatos de '
      f'{len(secs_out)} sectores (antes: solo los que ya estaban en la cartera)')

# ── 13. El estimador no puede mentir para abajo ───────────────────────────
# El boton existe para que Marcos decida ANTES de gastar. Un estimador que
# subestima es peor que no tenerlo. Estuvo 23-41% bajo desde que se agregaron
# `plan`, `riesgo` y los campos de riesgo de los candidatos, y ademas tenia el
# tamano del prompt clavado en 1249 mientras el prompt crecia al doble.
#
# Los valores de abajo se midieron sobre `_resumen_cartera()` con carteras
# reales el 31/08/2026. Si se agrega un bloque nuevo al payload, esta prueba
# falla y hay que volver a calibrar — que es exactamente lo que queremos.
# Re-medido el 31/08 DESPUES de sumar `benchmark` y `pares_que_son_una_apuesta`.
# Los valores anteriores (955, 1520, 2374, 2913, 3602, 4275) eran de antes de
# esos dos bloques, y como eran MAS BAJOS que la realidad nueva, esta guarda
# pasaba en verde mientras el estimador subestimaba de verdad. Si tocas el
# payload: volve a medir esto, no alcanza con que la prueba siga pasando.
# ⚠️ RE-MEDIDO el 02/09/2026 con `test/medir_payload.py`. Los anteriores
# (2393, 2854, 3452, 4060, 4619, 5344) eran de ANTES de comprimir los
# candidatos: como eran MAS ALTOS que la realidad nueva, esta guarda seguia
# pasando en verde mientras el estimador cobraba de mas.
#
# Ya no hay que medir a mano: `python test/medir_payload.py` imprime esta
# misma linea lista para pegar. Se hizo reproducible justamente porque este
# numero se quedo viejo cinco veces en cuatro dias.
MEDIDO = {3: 1343, 5: 1796, 10: 2832, 15: 3636, 20: 4339, 25: 5102}
for n_pos, real in MEDIDO.items():
    est = I.estimar_cartera(n_pos, 'anthropic')['tokens_estimados']['entrada']
    chequear(est >= real,
             f'{n_pos} posiciones: el estimador dice {est} y el payload real '
             f'son {real} tokens — subestima {round((real-est)/real*100)}%')
    # Tampoco puede irse al doble: un techo absurdo asusta y no informa.
    chequear(est <= real * 1.45 if n_pos >= 10 else est <= real * 1.6,
             f'{n_pos} posiciones: el estimador exagera ({est} vs {real})')

# El tamano de las reglas se MIDE. Si alguien vuelve a clavarlo, esto lo caza.
e = I.estimar_cartera(15, 'anthropic')
chequear(e['tokens_estimados']['reglas_cacheadas'] == len(I.SISTEMA_CARTERA) // 4,
         'el tamano del prompt cacheado no sale del prompt real')
chequear(e['costo_primera_vez_usd'] > e['costo_estimado_usd'],
         'la primera llamada tiene que costar mas: paga las reglas completas')
chequear(e['entra_en_el_limite'],
         f'15 posiciones ya no entran en los {I.TIMEOUT_CARTERA}s: '
         f'{e["segundos_estimados"]}s estimados')
# ── 15. EL PROMPT TIENE QUE NOMBRAR LO QUE EL PAYLOAD MANDA ───────────────
# Un campo que el payload manda y el prompt NO nombra es un calculo hecho al
# pedo: el modelo no sabe que existe. Es la version "hacia afuera" del bug que
# ya nos comimos dos veces con `_resumen_cartera` (una clave que no se nombra no
# llega). Aca es al reves: llega y nadie la mira.
#
# Esta guarda existe ademas porque el 31/08 el prompt se PODO de 4.344 a 3.142
# tokens, y podar es exactamente cuando se pierde una regla sin darse cuenta:
# en la primera pasada se cayeron `aporte_al_riesgo_pct` y `peso_objetivo_pct`.
CAMPOS_QUE_EL_PROMPT_DEBE_NOMBRAR = [
    'aporte_al_riesgo_pct', 'peso_objetivo_pct', 'limitado_por_tope',
    'limitado_por_grupo', 'grupos_limitantes', 'refuerzo_en_sector_al_tope',
    'mejor_que_el_plan_en_puntos', 'menu_por_sector', 'entradas_nuevas',
    'mejora_puntos', 'metricas_usadas', 'en_orden', 'peso_combinado_pct',
    'mismo_sector', 'retorno_sobre_volatilidad', 'topes_insuficientes',
    'cobertura_del_calculo_pct',
]
sin_nombrar = [c for c in CAMPOS_QUE_EL_PROMPT_DEBE_NOMBRAR
               if c not in I.SISTEMA_CARTERA]
chequear(not sin_nombrar,
         f'el payload manda estos campos y el prompt no los nombra, '
         f'asi que el modelo no sabe que existen: {sin_nombrar}')

# CUATRO secciones desde el 02/09: la quinta se mudo a su propia llamada.
import re as _re
secciones = _re.findall(r'^## (\d)\. (.+)$', I.SISTEMA_CARTERA, _re.M)
chequear(len(secciones) == 4,
         f'el prompt ya no pide 4 secciones sino {len(secciones)}: {secciones}')
chequear([n for n, _ in secciones] == ['1', '2', '3', '4'],
         f'las secciones estan desordenadas: {secciones}')
# Y tiene que decir explicitamente que NO escriba la del cliente. Sin esa
# linea el modelo la escribe igual —venia haciendolo hasta ayer— y se paga.
chequear('NO escribas un resumen para el cliente' in I.SISTEMA_CARTERA,
         'el prompt no le prohibe escribir el texto del cliente: lo va a '
         'escribir por inercia y se paga dos veces')
chequear('ESCRIBÍ EN TICKERS' in I.SISTEMA_CARTERA,
         'sin los nombres en el payload, el prompt TIENE que decir que se '
         'escribe en tickers: si no, el modelo los inventa')
print(f'  prompt de decision   -> {len(I.SISTEMA_CARTERA) // 4} tokens, '
      f'{len(CAMPOS_QUE_EL_PROMPT_DEBE_NOMBRAR)} campos nombrados, 4 secciones')

print(f'  estimador            -> nunca por debajo del payload real '
      f'({len(MEDIDO)} tamanos), reglas medidas del prompt')

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
