import { svelte } from '@sveltejs/vite-plugin-svelte';
import compression from 'vite-plugin-compression';

export default function config(env) {
  const mode = env.mode || 'development';
  return {
    plugins: [
      svelte(),
      mode === 'production' ? compression({ algorithm: 'gzip', ext: '.gz' }) : null,
    ].filter(Boolean),
    base: mode === 'production' ? './' : '/',
    server: {
      port: 5173,
      strictPort: true,
      origin: 'http://localhost:5173',
    },
    build: {
      target: 'es2021',
      outDir: mode === 'production' ? 'dist' : 'dist',
      minify: mode === 'production' ? 'esbuild' : false,
      rollupOptions: {
        output: {
          manualChunks: mode === 'production' ? {
            vendor: ['svelte', '@tauri-apps/api'],
            tauri: ['@tauri-apps/plugin-global-shortcut', '@tauri-apps/plugin-notification', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-fs'],
          } : undefined,
        },
      },
    },
  };
}
