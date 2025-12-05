import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';
import { downloadApiPlugin } from './vite-plugin-download-api';
import { swaggerPlugin } from './vite-plugin-swagger';

export default defineConfig({
  plugins: [react(), downloadApiPlugin(), swaggerPlugin()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
});
