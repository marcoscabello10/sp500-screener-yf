# Bot local de fundamentales

Corre desde tu PC para evitar el bloqueo de IP que Yahoo Finance aplica a
proveedores cloud (Vercel). Genera el snapshot que usa Fase 1 en la web.

## Uso

```bash
cd local_bot
pip install yfinance
python fetch_fundamentals.py
```

Tarda ~3-5 minutos para los ~504 símbolos (503 del S&P 500 + SPY).

Al terminar, generá el archivo `public/data/sp500_fundamentals.json`.
Para que la web use estos datos nuevos:

```bash
git add public/data/sp500_fundamentals.json
git commit -m "chore: actualizar snapshot de fundamentales"
git push
```

Vercel redeploya solo y la próxima vez que se abra F1 va a usar estos datos.

## ¿Con qué frecuencia correrlo?

Una vez por día alcanza y sobra. Los ratios fundamentales (P/E, ROE, D/E,
etc.) se actualizan trimestralmente con cada reporte de resultados — no
cambian de un día para el otro. El precio y el % de cambio sí varían
diariamente, así que si querés precios frescos, correlo la mañana de cada
día que vayas a usar la app.

## Automatizarlo (opcional, más adelante)

Se puede programar con el Programador de Tareas de Windows para que corra
solo todas las mañanas y haga el push automáticamente. No es necesario para
empezar — correrlo a mano cuando haga falta funciona perfecto.

## Si falla algo

- **`ModuleNotFoundError: No module named 'yfinance'`** → `pip install yfinance`
- **Muchos símbolos fallan** → revisá tu conexión a internet; alguna vez
  Yahoo puede tener downtime puntual, reintentá en unos minutos
- **Wikipedia devuelve menos de ~500 empresas** → puede haber cambiado el
  formato de la tabla en Wikipedia; avisar para revisar el scraping
