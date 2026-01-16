# Aztec Wallet Web App Tutorial

This tutorial demonstrates how to build a browser-based wallet application for Aztec using React and Vite. It showcases creating wallets, deploying contracts, and interacting with the Aztec network directly from a web browser.

## Aztec Version Compatibility

This example is compatible with **Aztec v3.0.0-devnet.6-patch.1**.

To set this version:

```bash
aztec-up 3.0.0-devnet.6-patch.1
```

## What You'll Build

A web application that demonstrates three core Aztec operations:

1. **Create Wallet** - Initialize a TestWallet with a Schnorr account
2. **Deploy Contract** - Deploy the PrivateVoting contract to Aztec
3. **Cast Vote** - Interact with the deployed contract

## Prerequisites

- Node.js v18 or higher
- Yarn package manager
- A running Aztec sandbox instance

## Quick Start

### 1. Install Dependencies

```bash
yarn install
```

### 2. Start Aztec Sandbox

```bash
aztec start --sandbox
```

The sandbox must be running on `http://localhost:8080` before starting the app.

### 3. Start Development Server

```bash
yarn dev
```

Open your browser to `http://localhost:5173` and click through the steps.

---

## Creating From Scratch

If you want to build this project from scratch, follow these steps:

### 1. Create Vite Project

```bash
yarn create vite testwallet-webapp-tutorial-new --template react-ts
cd testwallet-webapp-tutorial-new
yarn install
```

### 2. Install Aztec Dependencies

```bash
yarn add @aztec/accounts@3.0.0-devnet.6-patch.1 \
         @aztec/aztec.js@3.0.0-devnet.6-patch.1 \
         @aztec/test-wallet@3.0.0-devnet.6-patch.1 \
         @aztec/noir-contracts.js@3.0.0-devnet.6-patch.1
```

### 3. Install Build Tooling Dependencies

```bash
yarn add -D vite-plugin-node-polyfills @types/node
```

### 4. Configure Vite

Replace the default `vite.config.ts` with:

```typescript
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills, type PolyfillOptions } from "vite-plugin-node-polyfills";

const nodeModulesPath = `${searchForWorkspaceRoot(process.cwd())}/node_modules`;

// Workaround for vite-plugin-node-polyfills module resolution bug
// See: https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/81
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
```

---

## Understanding the Configuration

### Why These Vite Settings Are Required

Aztec's browser support requires several special configurations:

#### 1. WASM Multithreading Headers

```typescript
headers: {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
}
```

Aztec uses WebAssembly with SharedArrayBuffer for multithreaded cryptographic operations. Modern browsers require these CORS headers to enable SharedArrayBuffer for security reasons.

#### 2. Node.js Polyfills

```typescript
nodePolyfillsFix({
  include: ["buffer", "path", "process", "net", "tty"],
})
```

Aztec SDK packages (`@aztec/aztec.js`, `@aztec/accounts`, etc.) were originally designed for Node.js and depend on Node.js APIs that don't exist in browsers:

- **`buffer`** - Binary data handling used by cryptographic operations and WASM modules
- **`process`** - Environment variables and process information
- **`path`** - File path utilities used by module resolution
- **`net` & `tty`** - Required by the Pino logger used throughout Aztec SDK

The `vite-plugin-node-polyfills` provides browser-compatible implementations of these APIs.

**Note**: The `nodePolyfillsFix` wrapper is a workaround for a module resolution bug in vite-plugin-node-polyfills v0.19.0+ where the plugin's polyfill imports fail to resolve correctly during Vite's optimization phase, causing runtime errors even though builds succeed. The fix manually resolves polyfill paths to their absolute file system locations.

#### 3. Dependency Optimization

```typescript
optimizeDeps: {
  include: ['pino', 'pino/browser'],
  exclude: ['@aztec/noir-noirc_abi', '@aztec/noir-acvm_js', '@aztec/bb.js', '@aztec/noir-noir_js']
}
```

- **Include**: Pre-bundle the Pino logger for better performance
- **Exclude**: Prevent Vite from optimizing Aztec's WASM modules, which would break their loading mechanism

---

## Key Code Patterns

### Connecting to Aztec

```typescript
import { createAztecNodeClient } from '@aztec/aztec.js/node'
import { getPXEConfig } from '@aztec/pxe/client/lazy';
import { TestWallet } from '@aztec/test-wallet/client/lazy';

const nodeURL = 'http://localhost:8080';
const aztecNode = await createAztecNodeClient(nodeURL);
const config = getPXEConfig();
config.dataDirectory = 'pxe';
const wallet = await TestWallet.create(aztecNode, config);
```

### Creating a Schnorr Account

```typescript
import { getInitialTestAccountsData } from '@aztec/accounts/testing';

const [accountData] = await getInitialTestAccountsData();
const accountManager = await wallet.createSchnorrAccount(
  accountData.secret,
  accountData.salt,
  accountData.signingKey
);
const accountAddress = accountManager.address;
```

### Deploying a Contract

```typescript
import { PrivateVotingContract } from '@aztec/noir-contracts.js/PrivateVoting';

const deployedContract = await PrivateVotingContract.deploy(wallet, address)
  .send({ from: address })
  .deployed();
```

### Calling Contract Methods

```typescript
import { AztecAddress } from '@aztec/aztec.js/addresses'

const contract = await PrivateVotingContract.at(contractAddress, wallet);
await contract.methods.cast_vote(AztecAddress.random())
  .send({ from: address })
  .wait();
```

---

## Troubleshooting

### "Buffer is not defined" or "process is not defined"

**Problem**: Node.js polyfills aren't loading correctly.

**Solution**: Ensure you're using the `nodePolyfillsFix` wrapper in your Vite config (not the plain `nodePolyfills` plugin). The wrapper fixes a module resolution bug in the polyfills plugin.

### WASM Loading Errors

**Problem**: Errors about SharedArrayBuffer or WASM initialization failures.

**Solution**: Verify the CORS headers in your Vite config:
```typescript
headers: {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
}
```

Check browser console - these headers must be present in the response.

### Module Not Found Errors

**Problem**: Cannot resolve Aztec packages or their dependencies.

**Solution**:
- Ensure all Aztec packages are on the **same version** (e.g., `3.0.0-devnet.6-patch.1`)
- Verify WASM modules are excluded in `optimizeDeps.exclude`
- Clear Vite cache: `rm -rf node_modules/.vite`

### "Cannot connect to PXE" or Network Errors

**Problem**: Application can't reach the Aztec sandbox.

**Solution**:
- Ensure Aztec sandbox is running: `aztec start --sandbox`
- Verify it's accessible at `http://localhost:8080`
- Check CORS if sandbox is on a different port

---

## Project Structure

```
test-wallet-webapp/
├── src/
│   ├── App.tsx              # Main application component
│   ├── main.tsx             # Application entry point
│   ├── consoleInterceptor.ts # Console output capture utility
│   └── ...
├── vite.config.ts           # Vite configuration with Aztec compatibility
├── package.json             # Dependencies
└── README.md               # This file
```

---

## Learn More

- [Aztec Documentation](https://docs.aztec.network/)
- [Aztec.js API Reference](https://docs.aztec.network/apis/aztecjs)
- [Vite Documentation](https://vitejs.dev/)
- [vite-plugin-node-polyfills Issue #81](https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/81)
