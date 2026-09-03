import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  server: {
    proxy: {
      '/wot': {
        // The lab's default port. There is no config file that can move it any
        // more, so this and src/main.ts agree by construction.
        target: 'http://localhost:8081',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/wot/, '') || '/'
      }
    }
  },
  build: {
    outDir: 'dist',
    rolldownOptions: {
      output: {
        // Split the dependencies out from the app code. This does not shrink the
        // first load — every chunk is needed to paint — but the app chunk is the
        // only thing that changes when a source file is edited, so a rebuild
        // (`bun run dev` runs one on every start) no longer invalidates the ~700 kB
        // of React and Primer sitting behind an immutable cache header.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-is)[\\/]/ },
            { name: 'primer', test: /node_modules[\\/](@primer|@github|@oddbird|focus-visible)[\\/]/ }
          ]
        }
      }
    },
    // The vendor chunks are legitimately large and cannot be usefully split
    // further: Primer's `legacy-theme` alone is ~293 kB of source (every color
    // scheme as one object literal) and ThemeProvider imports it statically, so
    // there is no dynamic-import seam to find. Raise the advisory limit rather
    // than leave a warning nobody can action on every build.
    chunkSizeWarningLimit: 800
  }
});
