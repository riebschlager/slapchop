import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Worker-only deps are discovered lazily; without this, the first export in
  // dev triggers a re-optimize + full page reload that kills the export.
  optimizeDeps: {
    include: ['gifenc', 'jszip'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
