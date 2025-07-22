import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), nodePolyfills()],
  optimizeDeps: {
    include: ['pino', 'pino/browser'],
    exclude: ['@noir-lang/noirc_abi', '@noir-lang/acvm_js', '@aztec/bb.js']
  },
})
