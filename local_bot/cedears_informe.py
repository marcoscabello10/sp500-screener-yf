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

    # Deslistadas / disueltas / suspendidas.
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


def universo():
    """Devuelve {clave_BYMA: [candidatos de Yahoo en orden]} para lo que SI entra."""
    m = {t: [t] for t in DIRECTOS}
    m.update(TRADUCCION)
    return m


if __name__ == '__main__':
    u = universo()
    print(f'entran   : {len(u)}')
    print(f'excluidos: {len(EXCLUIDOS)}')
    print(f'total    : {len(u) + len(EXCLUIDOS)}')
