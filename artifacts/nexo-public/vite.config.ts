import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/nexo-public/';
const artifactRoot = path.resolve(import.meta.dirname);
const workspaceRoot = path.resolve(artifactRoot, '..', '..');
const sharedSource = path.resolve(workspaceRoot, 'artifacts/ai-chat/src');

export default defineConfig({
  base: basePath,
  define: {
    'import.meta.env.VITE_PUBLIC_KEY_MODE': JSON.stringify('true'),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      // Public is a thin shell around the canonical Nexo app, not a fork.
      '@': sharedSource,
      '@assets': path.resolve(workspaceRoot, 'attached_assets'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: artifactRoot,
  // The canonical Nexo app owns the logo and isolated code-runner document.
  publicDir: path.resolve(workspaceRoot, 'artifacts/ai-chat/public'),
  build: {
    outDir: path.resolve(artifactRoot, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
      allow: [workspaceRoot],
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
