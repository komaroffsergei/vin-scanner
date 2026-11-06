import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.DIAGNOSTICS_BASE || './',
  build: { assetsInlineLimit: 0, target: 'es2022' },
  worker: { format: 'es' },
});
