import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Native file events are missed here when git rewrites files (branch
    // switches, merges), leaving stale modules in the browser. Polling is reliable.
    watch: { usePolling: true, interval: 300 },
    // The API is same-origin through this proxy, so session cookies stay first-party.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
