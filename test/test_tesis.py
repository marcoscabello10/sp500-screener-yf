"""action=tesis — los dos proveedores, con la red simulada.

NO gasta un solo token: se reemplaza `_post_json` por un doble que devuelve la
forma exacta de cada API y registra a QUE URL se llamo. Ese registro es lo que
permite verificar lo unico que de verdad importa acá:

    si Marcos elige OpenAI, NO se toca Anthropic. Y al reves.

Es la regla que pidio con todas las letras y la que mas caro sale romper: un
fallback silencioso gastaria en un proveedor que no eligio.
"""
import importlib.util
import json
import sys
import io
import urllib.error
from pathlib import Path

D = Path('/mnt/user-data/uploads/sp500-screener-yf')
spec = importlib.util.spec_from_file_location('inf', '/home/claude/informe/build/informe.py')
I = importlib.util.module_from_spec(spec)
spec.loader.exec_module(I)

REAL = {n: json.loads((D / 'public' / 'data' / n).read_text(encoding='utf-8'))
        for n in ('sp500_fundamentals.json', 'informe_consenso.json',
                  'informe_detalle.json')}
I.estatico = lambda n: REAL[n]
I.historico_edgar = lambda t: {'disponible': False, 'avisos': [], 'cagr': {}, 'series': {}}

LLAMADAS = []
MODO_OPENAI = {'viejo': False}
TEXTO = ('Apple diseña y vende hardware y servicios. El veredicto es neutral '
         'porque la valuación pesa en contra mientras el resto acompaña. '
         'El argumento a favor es el flujo libre. La tesis falla si el margen cae.')


def falso_post(url, headers, cuerpo, timeout=None):
    LLAMADAS.append({'url': url, 'headers': dict(headers), 'cuerpo': cuerpo})
    if 'anthropic' in url:
        return {'content': [{'type': 'text', 'text': TEXTO}],
                'usage': {'input_tokens': 1240, 'output_tokens': 310}}
    if MODO_OPENAI['viejo'] and 'max_completion_tokens' in cuerpo:
        # Simula una cuenta cuyo modelo todavia solo acepta max_tokens: la API
        # rechaza el parametro nuevo con un 400 que lo nombra.
        raise urllib.error.HTTPError(
            url, 400, 'Bad Request', {},
            io.BytesIO(b'{"error":{"message":"Unsupported parameter: '
                       b'max_completion_tokens"}}'))
    return {'choices': [{'message': {'content': TEXTO}}],
            'usage': {'prompt_tokens': 1240, 'completion_tokens': 310}}


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


print('=' * 74)

# ── 1. Sin ninguna clave: no se llama a nadie ───────────────────────────────
limpiar()
for prov in ('anthropic', 'openai'):
    res, err = I.generar_tesis('AAPL', prov)
    chequear(res is None and err, f'{prov} sin clave deberia fallar')
    chequear(not LLAMADAS, f'{prov} sin clave NO puede llamar a la red')
print(f'  sin claves          -> no se hizo ninguna llamada  ({len(LLAMADAS)})')

# ── 2. LA REGLA: elegir uno no puede tocar al otro ─────────────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x', OPENAI_API_KEY='sk-oai-x')
res, err = I.generar_tesis('AAPL', 'anthropic')
urls = [c['url'] for c in LLAMADAS]
chequear(err is None, f'anthropic deberia funcionar: {err}')
chequear(all('anthropic' in u for u in urls), f'con anthropic se llamo a: {urls}')
chequear(not any('openai' in u for u in urls), 'ELIGIO ANTHROPIC Y TOCO OPENAI')
print(f'  elijo anthropic     -> {urls}')

limpiar(ANTHROPIC_API_KEY='sk-ant-x', OPENAI_API_KEY='sk-oai-x')
res2, err2 = I.generar_tesis('AAPL', 'openai')
urls2 = [c['url'] for c in LLAMADAS]
chequear(err2 is None, f'openai deberia funcionar: {err2}')
chequear(not any('anthropic' in u for u in urls2), 'ELIGIO OPENAI Y TOCO ANTHROPIC')
print(f'  elijo openai        -> {urls2}')

# el respaldo de max_tokens, para una cuenta con un modelo viejo
limpiar(OPENAI_API_KEY='sk-oai-x')
MODO_OPENAI['viejo'] = True
res_v, err_v = I.generar_tesis('AAPL', 'openai')
chequear(err_v is None, f'con la API vieja deberia reintentar y funcionar: {err_v}')
chequear(len(LLAMADAS) == 2, f'deberia haber 2 intentos, hubo {len(LLAMADAS)}')
chequear('max_tokens' in LLAMADAS[-1]['cuerpo'], 'el reintento deberia usar max_tokens')
MODO_OPENAI['viejo'] = False
print(f'  openai API vieja    -> reintenta con max_tokens y sale ({len(LLAMADAS)} intentos, '
      f'el 1o murio en 400 sin generar)')

# ── 3. Con SOLO una clave, pedir la otra falla sin llamar a nadie ──────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
res3, err3 = I.generar_tesis('AAPL', 'openai')
chequear(res3 is None and 'OpenAI' in err3, 'deberia decir que falta la clave de OpenAI')
chequear(not LLAMADAS, 'SE CAYO A ANTHROPIC EN VEZ DE FALLAR')
print(f'  solo anthropic, pido openai -> falla sin llamar a nadie ({len(LLAMADAS)} llamadas)')

limpiar(OPENAI_API_KEY='sk-oai-x')
res4, err4 = I.generar_tesis('AAPL', 'anthropic')
chequear(res4 is None and 'Anthropic' in err4, 'deberia decir que falta la clave de Anthropic')
chequear(not LLAMADAS, 'SE CAYO A OPENAI EN VEZ DE FALLAR')
print(f'  solo openai, pido anthropic -> falla sin llamar a nadie ({len(LLAMADAS)} llamadas)')

# ── 4. Proveedor invalido ──────────────────────────────────────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x', OPENAI_API_KEY='sk-oai-x')
for prov in ('', 'gemini', 'ANTHROPIC ', None):
    res5, err5 = I.generar_tesis('AAPL', prov)
    chequear(res5 is None, f'proveedor {prov!r} deberia rechazarse')
chequear(not LLAMADAS, 'un proveedor invalido no puede llamar a nadie')
print(f'  proveedor invalido  -> rechazado sin llamar a nadie')

# ── 5. Lo que devuelve ─────────────────────────────────────────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
res, err = I.generar_tesis('AAPL', 'anthropic')
esperadas = {'ticker', 'texto', 'proveedor', 'proveedor_nombre', 'modelo', 'tokens',
             'costo_estimado_usd', 'costo_nota', 'segundos', 'generado_en', 'descargo'}
chequear(set(res) == esperadas, f'claves de la respuesta: {sorted(set(res) ^ esperadas)}')
chequear(res['modelo'] == 'claude-sonnet-5', f'modelo por defecto: {res["modelo"]}')
esperado = round(1240 * 2 / 1e6 + 310 * 10 / 1e6, 5)
chequear(res['costo_estimado_usd'] == esperado,
         f'costo mal: {res["costo_estimado_usd"]} en vez de {esperado}')
print(f'  respuesta           -> {res["modelo"]}, {res["tokens"]}, '
      f'US$ {res["costo_estimado_usd"]}')

# ── 6. El tope de salida viaja siempre ─────────────────────────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x', OPENAI_API_KEY='sk-oai-x')
I.generar_tesis('AAPL', 'anthropic')
c = LLAMADAS[-1]['cuerpo']
chequear(c.get('max_tokens') == I.MAX_TOKENS_TESIS, 'anthropic sin tope de salida')
limpiar(OPENAI_API_KEY='sk-oai-x')
I.generar_tesis('AAPL', 'openai')
c = LLAMADAS[-1]['cuerpo']
chequear(c.get('max_tokens') == I.MAX_TOKENS_TESIS
         or c.get('max_completion_tokens') == I.MAX_TOKENS_TESIS,
         'openai sin tope de salida')
print(f'  tope de salida      -> {I.MAX_TOKENS_TESIS} tokens en los dos')

# ── 7. El prompt no lleva basura que se pague de gusto ────────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
I.generar_tesis('AAPL', 'anthropic')
prompt = LLAMADAS[-1]['cuerpo']['messages'][0]['content']
chequear('recommendations_trend' not in prompt, 'el sentimiento crudo no deberia viajar')
chequear('upgrades_downgrades' not in prompt, 'los upgrades crudos no deberian viajar')
chequear('"series"' not in prompt, 'las series historicas crudas no deberian viajar')
chequear(len(prompt) < 4000, f'el prompt pesa {len(prompt)} caracteres, demasiado')
print(f'  prompt              -> {len(prompt)} caracteres (~{len(prompt)//3.5:.0f} tokens), sin series crudas')

# ── 8. Ticker que no existe: no se gasta ──────────────────────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
res6, err6 = I.generar_tesis('NOEXISTE', 'anthropic')
chequear(res6 is None and err6, 'un ticker inexistente deberia fallar')
chequear(not LLAMADAS, 'un ticker inexistente NO puede llamar al modelo')
print(f'  ticker inexistente  -> no se llamo al modelo ({len(LLAMADAS)} llamadas)')

# ── 9. action=proveedores no gasta ────────────────────────────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
d = I.proveedores_disponibles()
chequear(d['anthropic']['disponible'] is True, 'anthropic deberia figurar disponible')
chequear(d['openai']['disponible'] is False, 'openai NO deberia figurar disponible')
chequear(not LLAMADAS, 'action=proveedores no puede llamar a nadie')
print(f'  action=proveedores  -> anthropic:si openai:no, sin llamadas')

print('=' * 74)
if fallos:
    for f in fallos:
        print('  ✗', f)
    print(f'\n{len(fallos)} FALLOS')
    sys.exit(1)
print('  Los dos proveedores andan y NINGUNO toca al otro. El tope de salida')
print('  viaja siempre, el prompt va limpio, y nada gasta antes de tener datos.')
print('  OK')

# ── 10. do_GET, la capa que los tests anteriores NO tocaban ────────────────
#
# Todo lo de arriba llama a generar_tesis() directo. El 26/08/2026 eso dejo
# pasar un bug que solo se veia en produccion: `action=proveedores` sin ticker
# devolvia 400 porque el guardia de ticker no lo tenia exceptuado. Resultado:
# el front preguntaba que claves habia, recibia un error, y NO MOSTRABA NINGUN
# BOTON aunque las claves estuvieran perfectas.
#
# Estos casos entran por el mismo camino que un navegador.
print()
RESPUESTAS = []

class HandlerFalso(I.handler):
    def __init__(self, path):
        self.path = path                      # sin llamar al __init__ real
    def _responder(self, codigo, cuerpo):
        RESPUESTAS.append((codigo, cuerpo))

def pedir(path):
    RESPUESTAS.clear()
    LLAMADAS.clear()          # si no, cada caso hereda las llamadas del anterior
    HandlerFalso(path).do_GET()
    return RESPUESTAS[-1]

limpiar(ANTHROPIC_API_KEY='sk-ant-x')

cod, cuerpo = pedir('/api/informe?action=proveedores')
chequear(cod == 200, f'action=proveedores sin ticker deberia dar 200, dio {cod}')
chequear(cuerpo.get('proveedores', {}).get('anthropic', {}).get('disponible') is True,
         'deberia informar que anthropic esta disponible')
chequear(not LLAMADAS, 'action=proveedores no puede llamar a ningun modelo')
print(f'  GET proveedores     -> {cod}, anthropic disponible, 0 llamadas')

cod, cuerpo = pedir('/api/informe?action=datos&ticker=AAPL')
chequear(cod == 200 and cuerpo.get('ticker') == 'AAPL', f'action=datos dio {cod}')
chequear(not LLAMADAS, 'action=datos NO puede llamar al modelo')
print(f'  GET datos           -> {cod}, sin llamar a ningun modelo')

cod, cuerpo = pedir('/api/informe?action=tesis&ticker=AAPL')
chequear(cod == 400 and 'proveedor' in cuerpo.get('error', ''),
         f'tesis sin proveedor deberia dar 400 pidiendo el proveedor, dio {cod}')
chequear(not LLAMADAS, 'tesis sin proveedor NO puede llamar a nadie')
print(f'  GET tesis sin prov. -> {cod}, no se llamo a nadie')

cod, cuerpo = pedir('/api/informe?action=tesis&ticker=AAPL&proveedor=anthropic')
chequear(cod == 200 and cuerpo.get('texto'), f'tesis con proveedor dio {cod}: {cuerpo}')
chequear(all('anthropic' in c['url'] for c in LLAMADAS), 'llamo a quien no debia')
print(f'  GET tesis anthropic -> {cod}, {len(LLAMADAS)} llamada a anthropic')

cod, cuerpo = pedir('/api/informe?action=tesis&ticker=AAPL&proveedor=openai')
chequear(cod == 400, f'sin clave de openai deberia dar 400, dio {cod}')
chequear(not LLAMADAS, 'SE CAYO AL OTRO PROVEEDOR DESDE do_GET')
print(f'  GET tesis openai    -> {cod} (sin clave), no se llamo a nadie')

cod, cuerpo = pedir('/api/informe?action=inventada&ticker=AAPL')
chequear(cod == 400 and 'inventada' in cuerpo.get('error', ''),
         f'accion desconocida deberia nombrarla: {cuerpo}')
print(f'  GET accion inventada-> {cod}, {cuerpo.get("error")}')

cod, cuerpo = pedir('/api/informe?action=datos')
chequear(cod == 400 and 'ticker' in cuerpo.get('error', ''), 'datos sin ticker deberia pedir el ticker')
print(f'  GET datos sin ticker-> {cod}, pide el ticker')

if fallos:
    for f in fallos:
        print('  ✗', f)
    print(f'\n{len(fallos)} FALLOS')
    sys.exit(1)
print('\n  do_GET tambien: ninguna accion gratuita gasta, y ninguna eleccion')
print('  de proveedor toca al otro.')
