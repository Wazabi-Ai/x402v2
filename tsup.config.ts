import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'client/index': 'src/client/index.ts',
    'server/index': 'src/server/index.ts',
    'types/index': 'src/types/index.ts',
    'chains/index': 'src/chains/index.ts',
    'facilitator/index': 'src/facilitator/index.ts',
    'bin/facilitator': 'src/bin/facilitator.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  treeshake: true,
  external: ['express', 'viem', 'crypto'],
  esbuildOptions(options) {
    options.banner = {
      js: '/* @wazabiai/x402 - x402 v2 Payment Protocol SDK */',
    };
  },
});
