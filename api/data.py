"""
PROXY DE YAHOO — RETIRADO EL 17/09/2026
=======================================

Este archivo servia `/api/data` con yfinance: cotizaciones, perfiles, ratios e
historico en vivo para el SCREENER. Ya no. Lo que queda es este cartel.

POR QUE SE FUE
--------------
Dos razones, y la segunda es la que forzo la mano.

1. NO SE USABA. En F2, F3 y F4 esta era la TERCERA fuente:

       const snap = await snapshotHistorico(...)      // 1. el snapshot local
       const cached = snap ? null : histCacheLoad()   // 2. el cache de 7 dias
       if (snap) {...} else if (cached) {...} else {
         histFetch(BASE, ...)                          // 3. recien aca
       }

   Y `historico_precios.json` viaja commiteado en el repo, asi que la rama 3
   practicamente nunca corria. En F1 se usaba solo para los papeles de AFUERA
   del S&P 500, adentro de un `try/catch` cuyo propio comentario admitia que
   "puede fallar si Yahoo esta bloqueando Vercel en ese momento" — que es la
   regla, no la excepcion: Yahoo bloquea las IP de datacenter, y esa es la
   razon por la que todo el proyecto usa bots locales.

2. ROMPIA EL DEPLOY. yfinance arrastra pandas + numpy + lxml + beautifulsoup4
   + html5lib + peewee: 227,64 MB de bundle de Python. Vercel, arriba de cierto
   tamaño, mete un paso de "Optimizing Python bundle" que borra archivos que
   despues el empaquetador busca:

       ENOENT: no such file or directory, lstat
       '.../site-packages/vercel_runtime/_vendor/werkzeug/wrappers/
        __pycache__/__init__.cpython-312.pyc'

   Los deploys del 17/09 fallaron los dos asi, con el mismo error en archivos
   DISTINTOS — una condicion de carrera adentro del builder de Vercel. Sin
   estas dependencias el bundle es de kilobytes y ese paso no corre.

   `api/informe.py`, que es el del informe avanzado, importa solo la biblioteca
   estandar. Nunca necesito nada de `requirements.txt`.

QUE HACER SI ALGUN DIA HACE FALTA DE VUELTA
-------------------------------------------
La respuesta casi siempre es: agregar el papel a `local_bot/tickers_informe.txt`
y correr `1-actualizar-datos.bat informe`. La cobertura hoy es de 664 papeles
(las 504 del S&P mas los 160 del informe que no estan en el indice).

Si de verdad hiciera falta pedir en vivo, el historial de git tiene la version
completa — pero traerla de vuelta trae tambien los 227 MB, asi que conviene
reescribirla con `urllib` en vez de yfinance.

POR QUE EL ARCHIVO SIGUE EXISTIENDO
-----------------------------------
Para que una pestaña vieja que todavia llame a `/api/data` reciba una respuesta
que se entiende, en vez de una pagina de error 404 en HTML que el `r.json()`
del front no puede parsear. Cuesta unos kilobytes y no instala nada.
"""
from http.server import BaseHTTPRequestHandler
import json


AVISO = {
    'error': 'endpoint_retirado',
    'mensaje': (
        'La descarga en vivo se retiro el 17/09/2026. Todos los datos salen '
        'del snapshot local: public/data/sp500_fundamentals.json, '
        'informe_detalle.json e historico_precios.json.'
    ),
    'que_hacer': (
        'Si falta un papel, agregalo a local_bot/tickers_informe.txt, corre '
        '1-actualizar-datos.bat informe y despues 2-subir-cambios.bat.'
    ),
    'desde': '2026-09-17',
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        cuerpo = json.dumps(AVISO, ensure_ascii=False).encode('utf-8')
        # 410 Gone y no 404: el recurso existia y se retiro a proposito. Un 404
        # se lee como "esta ruta esta mal escrita" y manda a buscar un bug que
        # no existe.
        self.send_response(410)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(cuerpo)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_POST(self):
        self.do_GET()

    def log_message(self, *args):
        pass
