import path from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig((overrideOptions) => ({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: !overrideOptions.watch,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  esbuildOptions(options) {
    options.alias = {
      '@': path.resolve(import.meta.dirname, './src'),
    };
  },
}));
