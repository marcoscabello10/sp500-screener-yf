# -*- coding: utf-8 -*-
"""
Universo de CEDEARs para EL INFORME (no para el screener).

Por que existe este archivo
---------------------------
La lista que se pasa por pantalla en un broker argentino usa el codigo de BYMA,
que en muchos casos NO es el ticker de la accion subyacente. "TXR" es Ternium
(TX), "NOKA" es Nokia (NOK), "BNG" es Bunge (BG). Si le pedimos "TXR" a Yahoo
nos devuelve basura o nada.

Este modulo traduce cada codigo a una CASCADA de candidatos. El validador y el
bot prueban en orden y se quedan con el primero que devuelva precio + sector +
capitalizacion. Asi la traduccion no depende de que yo haya acertado el simbolo
exacto: si el primero falla, hay red.

Convenciones
------------
- Clave  = como lo escribe Marcos / como figura en BYMA.
- Valor  = lista de simbolos de Yahoo a probar EN ORDEN.
- ADR sobre accion local (.DE, .PA, .TW): primero el ADR en USD, porque el
  informe compara multiplos entre papeles y mezclar monedas los rompe.

EXCLUIDOS (no entran al universo): estan abajo en EXCLUIDOS con el motivo.
Ninguno se descarta en silencio.
"""

# ─────────────────────────────────────────────────────────────────────────────
# 1. Codigos de BYMA que NO son el ticker subyacente.
#    Verificado uno por uno contra rava.com/perfil/<codigo> (agosto 2026).
# ─────────────────────────────────────────────────────────────────────────────
TRADUCCION = {
    'ADGO': ['AGRO'],                  # Adecoagro SA
    'KOFM': ['KOF'],                   # Coca-Cola FEMSA
    'NOKA': ['NOK'],                   # Nokia Oyj
    'TXR':  ['TX'],                    # Ternium SA
    'WBO':  ['WB'],                    # Weibo Corp
    'XROX': ['XRX'],                   # Xerox Holdings
    'BBV':  ['BBVA'],                  # Banco Bilbao Vizcaya Argentaria

    # Europeas: ADR en USD primero, accion local como respaldo.
    'ADS':  ['ADDYY', 'ADS.DE'],       # adidas AG
    'BAS':  ['BASFY', 'BAS.DE'],       # BASF SE
    'BAYN': ['BAYRY', 'BAYN.DE'],      # Bayer AG
    'BSN':  ['DANOY', 'BN.PA'],        # Danone SA
    'DTEA': ['DTEGY', 'DTE.DE'],       # Deutsche Telekom AG
    'EOAN': ['EONGY', 'EOAN.DE'],      # E.ON SE
    'MBG':  ['MBGYY', 'MBG.DE'],       # Mercedes-Benz Group AG

    # Asia
    'HHPD': ['HNHPF', '2317.TW'],      # Hon Hai Precision (Foxconn)
    'SMSN': ['SMSN.IL'],               # Samsung Electronics GDR (Londres)
}

# ─────────────────────────────────────────────────────────────────────────────
# 2. Tickers que ya son el simbolo real. Se prueban tal cual.
# ─────────────────────────────────────────────────────────────────────────────
DIRECTOS = [
    'AAP', 'ABEV', 'AEG', 'AEM', 'AI', 'ALAB', 'AMX', 'ANF', 'ARCO', 'ARM',
    'ASML', 'ASR', 'ASTS', 'AZN', 'B', 'BABA', 'BAK', 'BB', 'BBD', 'BCS',
    'BHP', 'BIDU', 'BIOX', 'BP', 'BSBR', 'CAAP', 'CAR', 'CCJ', 'CDE', 'CLS',
    'CX', 'DOCU', 'E', 'EQNR', 'ERIC', 'ETSY', 'FMX', 'GFI', 'GGB', 'GLNG',
    'GLOB', 'GPRK', 'GSK', 'GT', 'HDB', 'HIMS', 'HL', 'HMC', 'HMY', 'HOG',
    'HSBC', 'HUT', 'IBN', 'INFY', 'ING', 'IREN', 'JD', 'JMIA', 'JOYY', 'KB',
    'KEEL', 'KEP', 'KGC', 'LAC', 'LND', 'LYG', 'MELI', 'MP', 'MSTR', 'NBIS',
    'NIO', 'NMR', 'NVO', 'NVS', 'NXE', 'OKLO', 'ONDS', 'PAAS', 'PAC', 'PAGS',
    'PBI', 'PBR', 'RACE', 'RIO', 'RIOT', 'RKLB', 'ROKU', 'SAN', 'SAP',
    'SATL', 'SBS', 'SE', 'SHEL', 'SHOP', 'SNAP', 'SONY', 'SPCE', 'SPOT',
    'STLA', 'STNE', 'TIMB', 'TRIP', 'TSM', 'UGP', 'UL', 'UPST', 'URBN',
    'VALE', 'VIST', 'VOD', 'XP', 'XPEV', 'ZM',
]

# ─────────────────────────────────────────────────────────────────────────────
# 2b. LOS QUE FALTABAN, en tres grupos con motivos distintos (02/09/2026)
#
# Estaban afuera de las tres listas —ni entraban, ni estaban excluidos—, o sea
# que se descartaban EN SILENCIO, que es justo lo que la cabecera de este
# archivo promete que no pasa.
# ─────────────────────────────────────────────────────────────────────────────

# Dos CEDEAR grandes de Latinoamerica que simplemente no estaban. ITUB es el
# banco mas grande de Brasil y uno de los CEDEAR mas operados en Buenos Aires;
# apareció mirando la concentración por industria y no figuraba en ningún lado.
LATAM_QUE_FALTABAN = [
    'ITUB',                            # Itau Unibanco Holding
    'NU',                              # Nu Holdings (Nubank)
]

# Los ADR de empresas argentinas. Son acciones ordinarias o ADR que cotizan en
# NYSE/Nasdaq EN DOLARES, no CEDEARs: acá se compran igual, por el broker.
#
# Por que entran (decision de Marcos, 02/09/2026): son la unica forma de tener
# exposicion argentina MEDIBLE en el mismo lenguaje que el resto del universo
# —dolares, fundamentales de Yahoo, consenso de analistas y tres años de
# historico comparable—. La accion local equivalente cotiza en pesos y su serie
# de precios mezcla resultado con devaluacion, que es otra cosa.
#
# ⚠️ Entran con TOPE DE GRUPO, no sueltas. Ver `ARGENTINA` mas abajo.
ADR_ARGENTINOS = [
    'BBAR',                            # Banco BBVA Argentina
    'BMA',                             # Banco Macro
    'CEPU',                            # Central Puerto
    'CRESY',                           # Cresud
    'EDN',                             # Edenor
    'GGAL',                            # Grupo Financiero Galicia
    'IRS',                             # IRSA Inversiones y Representaciones
    'LOMA',                            # Loma Negra
    'PAM',                             # Pampa Energia
    'SUPV',                            # Grupo Supervielle
    'TEO',                             # Telecom Argentina
    'TGS',                             # Transportadora de Gas del Sur
    'TS',                              # Tenaris
    'YPF',                             # YPF
]

# Los CEDEAR que Comafi listo el 28-31/08/2026 y que NO estan en el S&P 500.
# Los otros diez de esa tanda (KLAC, DELL, WDC, GEV, MS, IBKR, WELL, PLD, LIN,
# SHW) si estan en el indice: a esos no hay que agregarlos acá, hay que
# marcarles el CEDEAR — ver `CEDEARS_CONFIRMADOS`.
CEDEARS_NUEVOS_2026 = [
    'NTRA',                            # Natera
    'SKHY',                            # SK Hynix (ADR en Nasdaq)
    'TLN',                             # Talen Energy
]

# ─────────────────────────────────────────────────────────────────────────────
# 2c. CEDEARS CONFIRMADOS A MANO — le ganan a la sonda de Yahoo
#
# EL PROBLEMA QUE RESUELVE (02/09/2026)
# ------------------------------------
# `hasCedear` no se decide acá: lo decide `fetch_fundamentals.check_cedear()`,
# que le pregunta a Yahoo si existe TICKER.BA, y guarda la respuesta 30 dias.
#
# Eso funciona para el estado de regimen y falla justo cuando importa. Medido:
# BYMA listo trece CEDEARs el 28/08/2026; la sonda habia corrido el 21/08; el
# snapshot del 31/08 dijo `hasCedear: False` para GE Vernova, Dell, Morgan
# Stanley, Linde, Prologis y cinco mas. Un CEDEAR nuevo tarda HASTA UN MES en
# aparecer, y ademas Yahoo puede no tener todavia el simbolo .BA de algo que en
# BYMA ya opera.
#
# Esta lista gana, y gana SOLO EN UNA DIRECCION: puede decir "esto SI tiene
# CEDEAR", nunca "esto NO tiene". Es el mismo criterio que ya usa
# `universo.js` cuando cruza las dos fuentes — un `false` no le saca el CEDEAR
# a nadie—, y por el mismo motivo: la fuente positiva es la que se verifico.
#
# Cada entrada lleva de donde salio y cuando. Sin eso, en seis meses nadie
# puede saber si sigue siendo cierto.
# ─────────────────────────────────────────────────────────────────────────────
CEDEARS_CONFIRMADOS = {
    # Tanda de Banco Comafi listada en BYMA el 28-31/08/2026. Los diez que ya
    # estan en el S&P 500: se agregan acá porque el universo del screener sale
    # del indice, no de este archivo, y lo unico que les falta es la marca.
    'KLAC': 'BYMA/Comafi 28-31/08/2026',   # KLA Corporation
    'DELL': 'BYMA/Comafi 28-31/08/2026',   # Dell Technologies
    'WDC':  'BYMA/Comafi 28-31/08/2026',   # Western Digital
    'GEV':  'BYMA/Comafi 28-31/08/2026',   # GE Vernova
    'MS':   'BYMA/Comafi 28-31/08/2026',   # Morgan Stanley
    'IBKR': 'BYMA/Comafi 28-31/08/2026',   # Interactive Brokers
    'WELL': 'BYMA/Comafi 28-31/08/2026',   # Welltower
    'PLD':  'BYMA/Comafi 28-31/08/2026',   # Prologis
    'LIN':  'BYMA/Comafi 28-31/08/2026',   # Linde
    'SHW':  'BYMA/Comafi 28-31/08/2026',   # Sherwin-Williams
    # Y los tres de esa misma tanda que no estan en el indice.
    'NTRA': 'BYMA/Comafi 28-31/08/2026',   # Natera
    'SKHY': 'BYMA/Comafi 28-31/08/2026',   # SK Hynix
    'TLN':  'BYMA/Comafi 28-31/08/2026',   # Talen Energy
}

# ─────────────────────────────────────────────────────────────────────────────
# 2d. EL GRUPO "ARGENTINA" — el tope que estos papeles necesitan
#
# POR QUE EXISTE
# --------------
# Un ADR argentino es un papel de beta alto cuyo riesgo principal NO es el de su
# empresa: es el del pais. Galicia, Macro, Supervielle y BBVA Argentina no son
# cuatro apuestas bancarias distintas, son cuatro nombres de la misma apuesta —
# igual que cuatro bancos son una sola apuesta por industria—. Sin un tope de
# grupo, el optimizador puede llevar la cartera al 40% argentino sin que nada lo
# frene, porque cada papel por separado entra en su tope de posicion y ninguno
# satura su sector (estan repartidos entre Financials, Energy, Utilities,
# Materials, Communication Services y Real Estate).
#
# Se resuelve con el MISMO mecanismo que ya existe para los sectores
# (`aplicarTopes` acepta topes de grupo desde el 31/08). No hay maquinaria
# nueva: hay una lista y un numero por perfil.
#
# LOS CASOS DE BORDE, decididos y anotados para no rediscutirlos:
#   · VIST  ENTRA. Vista esta incorporada en Mexico y cotiza en NYSE, pero
#           toda su produccion es Vaca Muerta. El riesgo es argentino.
#   · CAAP  ENTRA. Corporacion America Airports opera aeropuertos en varios
#           paises, pero Argentina es su mercado principal.
#   · TX    NO entra. Ternium SA es luxemburguesa y la mayor parte de su
#           operacion es Mexico. Su filial argentina (Ternium Argentina) es
#           otro papel, que cotiza en pesos.
#   · MELI  NO entra. Nacio en Argentina, pero hoy su resultado es
#           principalmente Brasil y Mexico y el mercado no lo opera como
#           riesgo argentino.
# Si alguno de estos cuatro tiene que cambiar de lado, es mover una linea.
# ─────────────────────────────────────────────────────────────────────────────
ARGENTINA = set(ADR_ARGENTINOS) | {'VIST', 'CAAP'}

# Cuanto riesgo argentino tolera cada perfil, como porcentaje de la cartera.
# No son numeros de mercado: son el techo que Marcos definio para que el plan
# no pueda concentrar ahi sin que se diga.
TOPE_ARGENTINA_POR_PERFIL = {
    'conservador': 10,
    'moderado':    20,
    'agresivo':    30,
}

# ─────────────────────────────────────────────────────────────────────────────
# 2e. LOS CODIGOS LOCALES DE LOS QUE YA TIENEN ADR
#
# Un cliente argentino no tiene "GGAL" el ADR: tiene GGAL la accion local, y en
# el Excel escribe el codigo de BYMA. Para la mitad de estas empresas el codigo
# local es el MISMO que el del ADR (GGAL, BMA, SUPV, LOMA, CEPU, EDN, BBAR,
# IRSA, TS) y todo funciona solo. Para la otra mitad NO, y ahi el papel
# simplemente no se encontraba:
#
#     el Excel dice     y el ADR es
#     YPFD              YPF
#     PAMP              PAM
#     TGSU2             TGS
#     TECO2             TEO
#     CRES              CRESY
#
# Se traduce al ADR y se analiza en dolares. Es la MISMA empresa: no se pierde
# nada y se gana el consenso de analistas y una serie de precios comparable.
# ─────────────────────────────────────────────────────────────────────────────
ALIAS_LOCALES = {
    'YPFD':  'YPF',                    # YPF
    'PAMP':  'PAM',                    # Pampa Energia
    'TGSU2': 'TGS',                    # Transportadora de Gas del Sur
    'TECO2': 'TEO',                    # Telecom Argentina
    'CRES':  'CRESY',                  # Cresud
    'IRSA':  'IRS',                    # IRSA
}
# TXR no va acá aunque sea el codigo local de Ternium: ya vive en TRADUCCION,
# que es el mecanismo para "el codigo de BYMA no es el ticker". Tenerlo en los
# dos lados haria que el alias apunte a 'TX', que no es una clave del universo
# sino un candidato de Yahoo — y el chequeo de abajo lo caza.

# ─────────────────────────────────────────────────────────────────────────────
# 2f. SOLO PARA MEDIR — las del Merval que NO tienen ADR
#
# LA DECISION (Marcos, 02/09/2026): entran, pero solo para que una cartera que
# las tiene se pueda ANALIZAR. Nunca como candidatas, y fuera del pool de
# percentiles.
#
# POR QUE ESA MITAD DE MEDIDA Y NO LAS DOS ENTERAS
# -----------------------------------------------
# Estas cotizan en PESOS, y eso rompe dos cosas y deja intacta una tercera:
#
#   · los MULTIPLOS sobreviven. P/E, P/B, ROE y margenes son cocientes: la
#     moneda se cancela. Por eso tiene sentido mostrarlos.
#   · el TAMAÑO no. Un market cap en pesos contra uno en dolares no compara, y
#     el percentil por sector se calcula contra todo el universo. Por eso NO
#     entran al pool: un solo papel en otra escala corre los percentiles de
#     todos los demas de su sector.
#   · la SERIE DE PRECIOS tampoco, y esta es la que decide. Tres años de
#     precios en pesos incluyen la devaluacion: el Motor B leeria eso como
#     volatilidad propia de la empresa y como correlacion con cualquier otro
#     papel argentino. Una cartera con dos de estas mediria un riesgo que no
#     es el riesgo, y peor: lo mediria alto, que es lo que parece prudente.
#
# Entonces: se muestran, cuentan para la concentracion por sector y por peso, y
# quedan explicitamente afuera del calculo de riesgo — que ya sabe decir "los
# numeros de riesgo cubren el X% de la cartera" cuando falta alguien.
#
# Las que SI tienen ADR no estan acá: esas se traducen (ver ALIAS_LOCALES) y se
# analizan completas, en dolares.
# ─────────────────────────────────────────────────────────────────────────────
SOLO_MEDIBLES = {
    'ALUA':  ['ALUA.BA'],              # Aluar Aluminio Argentino
    'BYMA':  ['BYMA.BA'],              # Bolsas y Mercados Argentinos
    'COME':  ['COME.BA'],              # Sociedad Comercial del Plata
    'CVH':   ['CVH.BA'],               # Cablevision Holding
    'METR':  ['METR.BA'],              # Metrogas
    'MIRG':  ['MIRG.BA'],              # Mirgor
    'TGNO4': ['TGNO4.BA'],             # Transportadora de Gas del Norte
    'TRAN':  ['TRAN.BA'],              # Transener
    'TXAR':  ['TXAR.BA'],              # Ternium Argentina
    'VALO':  ['VALO.BA'],              # Grupo Financiero Valores
}

# ─────────────────────────────────────────────────────────────────────────────
# 3. Lo que NO entra, con el motivo. Se documenta para no volver a discutirlo.
# ─────────────────────────────────────────────────────────────────────────────
EXCLUIDOS = {
    # Ya estan en el universo del screener (503 del S&P). Pedirlos de nuevo
    # duplicaria el papel y romperia los percentiles por sector.
    'BKR': 'ya en el S&P500', 'BX': 'ya en el S&P500', 'CAH': 'ya en el S&P500',
    'HON': 'ya en el S&P500', 'HOOD': 'ya en el S&P500', 'HSY': 'ya en el S&P500',
    'IP': 'ya en el S&P500', 'JCI': 'ya en el S&P500', 'MMM': 'ya en el S&P500',
    'MOS': 'ya en el S&P500', 'O': 'ya en el S&P500', 'QCOM': 'ya en el S&P500',
    'SNDK': 'ya en el S&P500', 'T': 'ya en el S&P500', 'TSLA': 'ya en el S&P500',
    'XYZ': 'ya en el S&P500',
    'DISN': 'codigo BYMA de Disney (DIS), ya en el S&P500',
    'BA.C': 'Boeing en dolares (BA), ya en el S&P500',
    'BK':   'BNY Mellon cambio de ticker a BNY en 2025; ya lo tenemos como BNY',
    'BNG':  'codigo BYMA de Bunge (BG), que ya esta en el S&P500',

    # Misma empresa en otra plaza: duplicaria el papel con otra moneda.
    'ABEV3': 'accion local de Ambev en B3; usamos el ADR ABEV',
    'VALE3': 'accion local de Vale en B3; usamos el ADR VALE',

    # ETFs: no tienen P/E, ROE ni margenes. El informe entero se cae.
    'CIBR': 'ETF (First Trust Cybersecurity), no tiene fundamentals',
    'ITA':  'ETF (iShares Aerospace & Defense), no tiene fundamentals',
    'SH':   'ETF inverso (ProShares Short S&P500), no tiene fundamentals',
    # Los cinco ETF de la tanda de Comafi del 28/08/2026. Se listan acá para
    # que quede escrito que se los vio y se los dejo afuera a proposito: la
    # tanda fueron 18 papeles y solo entran los 13 de acciones.
    'BBCA': 'ETF (JPMorgan BetaBuilders Canada), tanda 28/08/2026',
    'BBAX': 'ETF (JPMorgan BetaBuilders Asia Pacific ex-Japan), tanda 28/08/2026',
    'GSG':  'ETF (iShares S&P GSCI Commodity), tanda 28/08/2026',
    'CORN': 'ETF (Teucrium Corn Fund), tanda 28/08/2026',
    'SOYB': 'ETF (Teucrium Soybean Fund), tanda 28/08/2026',

    # Deslistadas / disueltas / suspendidas.
    #
    # ⚠️ Estos dos aparecen en TODAS las listas de "ADR argentinos" que circulan
    # y los dos estan muertos. Verificado el 02/09/2026 antes de agregarlos:
    'DESP': 'Despegar dejo de cotizar el 15/05/2025: Prosus compro la empresa',
    'IRCP': 'IRSA Propiedades Comerciales se fusiono en IRSA (Nasdaq ECA2022-120); '
            'la exposicion es IRS',
    'AABA': 'Altaba se disolvio en 2019',
    'AUY':  'Yamana Gold se fusiono en Pan American Silver (PAAS) en 2023',
    'PTR':  'PetroChina se deslisto del NYSE en 2022',
    'SNP':  'Sinopec se deslisto del NYSE en 2022',
    'LFC':  'China Life se deslisto del NYSE en 2022',
    'AOCA': 'Aluminum Corp of China (ACH) se deslisto del NYSE en 2022',
    'ATAD': 'Tatneft: ADR suspendido desde 2022 (sanciones a Rusia)',
    'MBT':  'Mobile TeleSystems: ADR deslistado en 2022 (sanciones a Rusia)',
    'NLM':  'Novolipetsk Steel: ADR suspendido desde 2022 (sanciones a Rusia)',

    # Sin respuesta de Yahoo en DOS corridas separadas (25/08/2026): `.info`
    # vuelve vacio, sin sector ni precio. No es rate limit — se reintentaron y
    # dieron igual. Puede ser que el ADR haya dejado el NYSE y ahora opere OTC o
    # solo en su plaza local. Se dejan afuera por ahora, sin cerrar el tema:
    # `local_bot/probe_vacios.py` prueba los simbolos alternativos de cada uno
    # (EMBR3.SA, ORANY, CAJPY, PCAR3.SA...) cuando se quiera retomar.
    'BRFS': 'sin respuesta de Yahoo en dos corridas; probar BRFS3.SA con probe_vacios.py',
    'CAJ':  'sin respuesta de Yahoo en dos corridas; probar CAJPY o 7751.T',
    'CBRD': 'sin respuesta de Yahoo en dos corridas; probar CBDBY o PCAR3.SA',
    'EBR':  'sin respuesta de Yahoo en dos corridas; probar ELET3.SA',
    'ELP':  'sin respuesta de Yahoo en dos corridas; probar CPLE6.SA',
    'ERJ':  'sin respuesta de Yahoo en dos corridas; probar EMBR3.SA',
    'LAR':  'sin respuesta de Yahoo en dos corridas; probar LAAC.TO',
    'ORAN': 'sin respuesta de Yahoo en dos corridas; probar ORANY o ORA.PA',

    # OTC con contabilidad que no se puede comparar contra el resto.
    'FNMA':  'Fannie Mae cotiza OTC en concurso desde 2008; los multiplos no comparan',
    'FMCC':  'Freddie Mac cotiza OTC en concurso desde 2008; los multiplos no comparan',
    'HNPIY': 'Huaneng Power ADR OTC, cobertura de analistas casi nula',
}


def todos_los_directos():
    """Los cuatro grupos que se prueban tal cual, sin traduccion.

    Estan separados arriba porque cada uno entro por un motivo distinto y ese
    motivo es lo que hay que poder leer dentro de seis meses. Acá se juntan.
    """
    return sorted(set(DIRECTOS) | set(LATAM_QUE_FALTABAN)
                  | set(ADR_ARGENTINOS) | set(CEDEARS_NUEVOS_2026))


def universo():
    """Devuelve {clave_BYMA: [candidatos de Yahoo en orden]} para lo que SI entra."""
    m = {t: [t] for t in todos_los_directos()}
    m.update(TRADUCCION)
    return m


def tiene_cedear_confirmado(sym):
    """¿Sabemos A MANO que este papel tiene CEDEAR?

    Solo puede decir que SI. Un `False` de acá no significa nada: significa
    "no esta en la lista curada", y la respuesta la sigue dando Yahoo.
    """
    return sym in CEDEARS_CONFIRMADOS


def es_riesgo_argentino(sym):
    return sym in ARGENTINA


def resolver_alias(sym):
    """El codigo que escribio el cliente -> el simbolo que usamos.

    Devuelve el mismo simbolo si no hay alias. Es a proposito: quien llama no
    tiene que saber si habia traduccion o no."""
    return ALIAS_LOCALES.get((sym or '').strip().upper(), (sym or '').strip().upper())


def es_solo_medible(sym):
    """Cotiza en pesos: se puede mostrar y sumar a la concentracion, pero no
    puntuar contra el resto ni meter en la matriz de riesgo."""
    return (sym or '').strip().upper() in SOLO_MEDIBLES


if __name__ == '__main__':
    u = universo()
    print(f'entran       : {len(u)}')
    print(f'  directos   : {len(DIRECTOS)}')
    print(f'  latam       : {len(LATAM_QUE_FALTABAN)}  {" ".join(LATAM_QUE_FALTABAN)}')
    print(f'  ADR arg.    : {len(ADR_ARGENTINOS)}  {" ".join(ADR_ARGENTINOS)}')
    print(f'  CEDEAR 2026 : {len(CEDEARS_NUEVOS_2026)}  {" ".join(CEDEARS_NUEVOS_2026)}')
    print(f'  traducidos  : {len(TRADUCCION)}')
    print(f'excluidos    : {len(EXCLUIDOS)}')
    print(f'total        : {len(u) + len(EXCLUIDOS)}')
    print(f'confirmados a mano : {len(CEDEARS_CONFIRMADOS)}')
    print(f'grupo Argentina    : {len(ARGENTINA)}  {" ".join(sorted(ARGENTINA))}')
    # La comprobacion que evita el error mas facil de cometer acá: un ticker
    # que este a la vez adentro y afuera. Pasó con BK y con BNG.
    print(f'solo medibles (ARS): {len(SOLO_MEDIBLES)}  {" ".join(sorted(SOLO_MEDIBLES))}')
    print(f'alias locales      : {len(ALIAS_LOCALES)}')
    # La comprobacion que evita el error mas facil de cometer acá: un ticker
    # que este a la vez adentro y afuera. Pasó con BK y con BNG.
    choque = sorted(set(u) & set(EXCLUIDOS))
    print('CHOQUE entra-y-excluido:', choque if choque else 'ninguno')
    # Y que un "solo medible" no sea tambien un papel normal: seria el mismo
    # papel dos veces, en dos monedas.
    choque2 = sorted(set(u) & set(SOLO_MEDIBLES))
    print('CHOQUE normal-y-medible:', choque2 if choque2 else 'ninguno')
    # Un alias tiene que apuntar a algo que exista.
    huerfanos = sorted(v for v in ALIAS_LOCALES.values() if v not in u)
    print('ALIAS que apuntan a la nada:', huerfanos if huerfanos else 'ninguno')
