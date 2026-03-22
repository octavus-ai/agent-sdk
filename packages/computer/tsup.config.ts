import path from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  esbuildOptions(options) {
    options.alias = {
      '@': path.resolve(import.meta.dirname, './src'),
    };
  },
});
