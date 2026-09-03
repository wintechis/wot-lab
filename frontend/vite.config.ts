import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  server: {
    proxy: {
      '/wot': {
        target: 'http://localhost:8043',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/wot/, '') || '/'
      }
    }
  },
  build: {
    outDir: 'dist'
  }
});