# Note Hash Computation Verification

A demonstration of creating private notes in Aztec smart contracts with controlled randomness, enabling verification that computed note hashes match on-chain note hashes. This project showcases the complete note hash computation chain in Aztec v3.

## Overview

This project implements:

- **Custom UintNote**: A note type with controllable randomness (default: 6969) for reproducible hash computation
- **Note Hash Computation**: Scripts demonstrating the v3 note hash formula
- **Hash Verification**: Tests that verify computed unique note hashes match on-chain hashes

**Aztec Version**: `3.0.0-devnet.20251212`

## Note Hash Computation Formula (v3)

The v3 note hash is computed in stages:

```
1. commitment = poseidon2([owner, storage_slot, randomness], GENERATOR_INDEX__NOTE_HASH)
2. note_hash = poseidon2([commitment, value], GENERATOR_INDEX__NOTE_HASH)
3. siloed_note_hash = poseidon2([contract_address, note_hash], GENERATOR_INDEX__NOTE_HASH)
4. unique_note_hash = poseidon2([nonce, siloed_note_hash], GENERATOR_INDEX__NOTE_HASH)
```

The unique note hash is what gets stored on-chain in the note hash tree.

## Prerequisites

- [Node.js](https://nodejs.org/) (v20 or higher)
- [Aztec CLI](https://docs.aztec.network/getting_started/quickstart)
- [Yarn](https://yarnpkg.com/) package manager
- Linux/macOS (Windows users can use WSL2)

To set the correct Aztec version:

```bash
aztec-up 3.0.0-devnet.20251212
```

## Project Structure

```
.
├── sample-contract/      # Aztec smart contract
│   ├── src/main.nr      # GettingStarted contract with note creation
│   └── Nargo.toml       # Contract configuration
├── uint-note/           # Custom UintNote library with controlled randomness
│   ├── src/uint_note.nr # UintNote with create_note_with_randomness function
│   └── Nargo.toml       # Library configuration
├── contract/
│   └── artifacts/       # Generated TypeScript bindings
├── scripts/             # TypeScript utilities
│   └── generate_data.ts # Creates notes and verifies hash computation
├── tests/               # Integration tests
│   └── note_creation.test.ts  # Hash verification test suite
├── package.json         # Node.js package configuration
├── tsconfig.json        # TypeScript configuration
├── jest.config.js       # Jest test configuration
└── data.json           # Generated note hash data (created by `yarn data`)
```

## Installation

### Install dependencies:

```bash
yarn install
```

### Install Aztec CLI:

```bash
bash -i <(curl -s https://install.aztec.network)
```

### Set Aztec to the correct version:

```bash
aztec-up 3.0.0-devnet.20251212
```

## Build & Compile

### Compile the Aztec Contract and Generate TypeScript Bindings

```bash
yarn ccc
```

This command:

- Compiles the Aztec contract using `aztec compile`
- Generates TypeScript bindings in `contract/artifacts/`

## Running the Example

### 1. Start Aztec Local Network

Start the local Aztec network:

```bash
aztec start --local-network
```

Keep this running in a separate terminal. The network runs at `http://localhost:8080`.

### 2. Run Tests

```bash
yarn test
```

The tests will:
1. Deploy the GettingStarted contract
2. Create a note with a known value and fixed randomness (6969)
3. Compute the expected note hash using the v3 formula
4. Verify that the computed hash matches the on-chain hash

## Complete Workflow

For a fresh setup, run these commands in order:

```bash
# 1. Install dependencies
yarn install

# 2. Setup Aztec
aztec-up 3.0.0-devnet.20251212

# 3. Compile contract and generate TypeScript bindings
yarn ccc

# 4. Start local network (in a new terminal)
aztec start --local-network

# 5. Run tests (in original terminal)
yarn test
```

## Testing

### Run All Tests

The project includes a comprehensive test suite for note hash verification:

```bash
yarn test
```

### Integration Tests

The test suite (`tests/note_creation.test.ts`) includes:
- Contract deployment verification
- Note creation with fixed randomness
- Note hash computation verification (computed hash matches on-chain)
- Multiple note creation with different values

## How It Works

### Contract (sample-contract/src/main.nr)

The GettingStarted contract creates notes with a fixed randomness value:

```noir
global NOTE_RANDOMNESS: Field = 6969;

#[external("private")]
fn create_note_for_user(value: u128) {
    let note = UintNote::new(value);
    create_note_with_randomness(
        self.context,
        self.context.msg_sender().unwrap(),
        1,  // storage_slot
        note,
        NOTE_RANDOMNESS,
    );
}
```

### Custom UintNote (uint-note/src/uint_note.nr)

The custom UintNote library provides `create_note_with_randomness` which bypasses the default random() call, enabling deterministic hash computation:

```noir
pub fn create_note_with_randomness<Note>(
    context: &mut PrivateContext,
    owner: AztecAddress,
    storage_slot: Field,
    note: Note,
    randomness: Field,
) where
    Note: NoteType + NoteHash + Packable,
{
    let note_hash = note.compute_note_hash(owner, storage_slot, randomness);
    notify_created_note(owner, storage_slot, randomness, ...);
    context.push_note_hash(note_hash);
}
```

### Hash Verification (tests/note_creation.test.ts)

The test computes the same hash off-chain and verifies it matches:

```typescript
// v3 hash computation
const commitment = await poseidon2HashWithSeparator(
  [owner, storage_slot, randomness],
  GENERATOR_INDEX__NOTE_HASH
);
const noteHash = await poseidon2HashWithSeparator(
  [commitment, value],
  GENERATOR_INDEX__NOTE_HASH
);

// Complete the chain: note_hash -> siloed -> unique
const siloedNoteHash = await siloNoteHash(contractAddress, noteHash);
const uniqueNoteHash = await computeUniqueNoteHash(nonce, siloedNoteHash);

// Verify against on-chain
expect(uniqueNoteHash).toBe(txEffect.data.noteHashes[0]);
```

## Troubleshooting

### Common Issues

1. **"Cannot find module './contract/artifacts/GettingStarted'"**

   - Run `yarn ccc` to generate the contract artifacts

2. **"Failed to connect to PXE" or Network Errors**

   - Ensure the Aztec local network is running: `aztec start --local-network`
   - Check it's accessible at `http://localhost:8080`

3. **TypeScript/Module errors**
   - Run `yarn install` to ensure all dependencies are installed
   - Recompile with `yarn ccc`

### Clean Rebuild

If you encounter issues, try a clean rebuild:

```bash
# Remove generated files
rm -rf sample-contract/target uint-note/target contract/artifacts node_modules

# Rebuild everything
yarn install
yarn ccc
yarn test
```

## Available Scripts

- `yarn ccc`: Compile contract and generate TypeScript artifacts
- `yarn test`: Run integration test suite
- `yarn data`: Generate note data and verify hash computation
- `yarn clean`: Remove generated data files

## Resources

- [Aztec Documentation](https://docs.aztec.network/)
- [Noir Language Documentation](https://noir-lang.org/)
- [Aztec Note Hash Computation](https://docs.aztec.network/protocol-specs/state/note-hash-tree)

## Related Examples

- [recursive_verification](../recursive_verification/) - Demonstrates Noir proof verification in Aztec contracts
