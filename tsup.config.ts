import { defineConfig } from 'tsup';
import { copyFileSync } from 'fs';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@supabase/supabase-js',
    /^@radix-ui\//,
    'boring-avatars',
  ],
  treeshake: true,
  minify: false,
  onSuccess: async () => {
    copyFileSync('src/overlay/styles/overlay.css', 'dist/style.css');
  },
});
