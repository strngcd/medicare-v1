import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API is same-origin through this proxy, so session cookies stay first-party.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
