import { svelte } from '@sveltejs/vite-plugin-svelte';

export default function config(env) {
  const mode = env.mode || 'development';
  return {
    plugins: [svelte()],
    base: mode === 'production' ? './' : '/',
    server: {
      port: 5173,
      strictPort: true,
      origin: 'http://localhost:5173',
    },
    build: {
      target: 'es2021',
      outDir: mode === 'production' ? 'dist' : 'dist',
    },
  };
}
