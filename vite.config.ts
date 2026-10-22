import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ipaStubPath = resolve(__dirname, 'src/lib/ipa-stub.ts');

// https://vite.dev/config/
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      './ipa': ipaStubPath,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: 'stub-ipa',
          setup(build) {
            build.onResolve({ filter: /^\.\/ipa$/ }, (args) => {
              if (args.importer.includes('app-info-parser/src/index.js')) {
                return { path: ipaStubPath };
              }
            });
          },
        },
      ],
    },
  },
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
            if (id.includes('@yume-chan')) return 'vendor-yume';
            if (id.includes('lucide-react')) return 'vendor-icons';
          }
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
  plugins: [
    react(),
  ],
})
