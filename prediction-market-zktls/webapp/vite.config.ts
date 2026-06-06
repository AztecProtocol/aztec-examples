import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills, type PolyfillOptions } from 'vite-plugin-node-polyfills'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'

const nodeModulesPath = `${searchForWorkspaceRoot(process.cwd())}/node_modules`

// Fix for vite-plugin-node-polyfills resolution in workspace setups
const nodePolyfillsFix = (options?: PolyfillOptions | undefined) => {
  return {
    ...nodePolyfills(options),
    resolveId(source: string) {
      const m =
        /^vite-plugin-node-polyfills\/shims\/(buffer|global|process)$/.exec(source)
      if (m) {
        return `${nodeModulesPath}/vite-plugin-node-polyfills/shims/${m[1]}/dist/index.cjs`
      }
    },
  }
}

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  plugins: [
    react(),
    nodePolyfillsFix({
      protocolImports: true,
    }),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@primuslabs/zktls-page-core-sdk/dist/algorithm/client_plugin.wasm',
          dest: './',
        },
        {
          src: 'node_modules/@primuslabs/zktls-page-core-sdk/dist/algorithm/client_plugin.worker.js',
          dest: './',
        },
        {
          src: 'node_modules/@primuslabs/zktls-page-core-sdk/dist/algorithm/client_plugin.js',
          dest: './',
        },
        {
          src: 'node_modules/@primuslabs/zktls-page-core-sdk/dist/algorithm/primus_zk.js',
          dest: './',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@artifacts': path.resolve(__dirname, '../artifacts'),
    },
  },
  optimizeDeps: {
    include: ['pino', 'pino/browser'],
    exclude: ['@aztec/noir-noirc_abi', '@aztec/noir-acvm_js', '@aztec/bb.js', '@aztec/noir-noir_js'],
  },
})
