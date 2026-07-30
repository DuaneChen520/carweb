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
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['ya-webadb-main/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
  plugins: [
    react(),
  ],
})
