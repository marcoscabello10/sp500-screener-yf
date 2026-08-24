import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Punto de entrada del INFORME AVANZADO (informe.html).
// El screener tiene el suyo en src/main.jsx y monta en #root: son dos apps
// independientes que solo comparten dominio.
ReactDOM.createRoot(document.getElementById('root-informe')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
