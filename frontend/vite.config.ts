import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_');
  const backendUrl = environment.VITE_BACKEND_URL || 'http://127.0.0.1:8000';
  const target = new URL(backendUrl);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) {
    throw new Error('Invalid backend URL configuration.');
  }
  // Same-origin proxy avoids changing backend CORS or exposing case data in URLs.
  const proxy = { '/api': { target: backendUrl, changeOrigin: false, rewrite: (requestPath: string) => requestPath.replace(/^\/api/, '') } };
  return {
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
    build: { target: ['es2022', 'safari16.4'], sourcemap: false },
    test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
  };
});
