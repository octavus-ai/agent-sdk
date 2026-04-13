import path from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig((overrideOptions) => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: !overrideOptions.watch,
  sourcemap: true,
  esbuildOptions(options) {
    options.alias = {
      '@': path.resolve(import.meta.dirname, './src'),
    };
  },
}));
