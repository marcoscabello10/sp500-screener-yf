import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Multipagina: dos apps independientes en el mismo deploy.
//   /            -> index.html   -> src/main.jsx    -> src/App.jsx   (SCREENER)
//   /informe     -> informe.html -> src/informe/    (INFORME AVANZADO)
// Comparten dominio (por eso el informe puede leer el localStorage del
// screener) pero NO comparten codigo: bundles separados, cero imports cruzados.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        informe: resolve(__dirname, 'informe.html'),
      },
    },
  },
})
