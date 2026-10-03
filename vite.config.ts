import { defineConfig } from 'vite';

// Configuración de Vite para el Animador VRM
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500
  }
});
