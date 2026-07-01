import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/ampdex/',
  // Single-page app, one data-heavy bundle; gzip is ~325 kB. Silence the
  // advisory rather than code-split for no real-world load benefit.
  build: { chunkSizeWarningLimit: 1600 },
})
