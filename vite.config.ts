import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'demo' ? './' : '/',
  build: { outDir: mode === 'demo' ? 'dist/demo' : 'dist/client' }
}));
