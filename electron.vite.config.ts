import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // Constantes de compilación del updater (ver src/main/updater.ts).
    define: {
      __UPDATE_URL__: JSON.stringify(process.env.NOTETAKER_UPDATE_URL?.trim() ?? ''),
      __MAC_AUTO_UPDATE__: JSON.stringify(process.env.NOTETAKER_MAC_AUTO_UPDATE === 'true')
    }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        ...shared
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
