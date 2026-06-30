import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base для GitHub Pages = '/<repo-name>/'. Поменяй при необходимости или задай GHPAGES_BASE.
export default defineConfig({
  plugins: [react()],
  base: process.env.GHPAGES_BASE || '/traffic-fraud-detector/',
  // Явный пустой PostCSS: не даёт Vite подхватить чужой ~/postcss.config.js (tailwind).
  css: { postcss: {} },
})
