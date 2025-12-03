import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills, type PolyfillOptions } from "vite-plugin-node-polyfills";

const nodeModulesPath = `${searchForWorkspaceRoot(process.cwd())}/node_modules`;

// Unfortunate, but needed due to https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/81
// Suspected to be because of the yarn workspace setup, but not sure
const nodePolyfillsFix = (options?: PolyfillOptions | undefined) => {
  return {
    ...nodePolyfills(options),
    resolveId(source: string) {
      const m =
        /^vite-plugin-node-polyfills\/shims\/(buffer|global|process)$/.exec(
          source,
        );
      if (m) {
        return `${nodeModulesPath}/vite-plugin-node-polyfills/shims/${m[1]}/dist/index.cjs`;
      }
    },
  };
};

// https://vite.dev/config/
export default defineConfig({
  server: {
    // Headers needed for bb WASM to work in multithreaded mode
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  plugins: [
    react(),
    nodePolyfillsFix({
        include: ["buffer", "path", "process", "net", "tty"],
    }),
  ],
  optimizeDeps: {
    include: ['pino', 'pino/browser'],
    exclude: ['@aztec/noir-noirc_abi', '@aztec/noir-acvm_js', '@aztec/bb.js', '@aztec/noir-noir_js']
  },
})
