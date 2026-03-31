import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'node:fs'

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(
      (() => {
        try {
          const pkgRaw = fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
          const pkg = JSON.parse(pkgRaw) as { version?: string }
          return pkg.version ?? '0.0.0'
        } catch {
          return '0.0.0'
        }
      })(),
    ),
    __APP_CREDITS__: JSON.stringify('con <3 de Adalk033'),
    __APP_REPO_URL__: JSON.stringify('https://github.com/Adalk033/Store'),
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    electron([
      {
        entry: 'electron/main.ts',
        onstart({ startup }) {
          startup();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['better-sqlite3'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['better-sqlite3'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
