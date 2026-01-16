# Custom Note Contract

An Aztec Noir contract demonstrating how to create and use custom note types in the Aztec protocol.

## Overview

This project showcases how to define a custom note structure with multiple fields and use it in a private smart contract. The contract stores custom notes in a private state that can only be viewed by the note owner.

## Custom Note Structure

The `CustomNote` contains:

- **a, b, c, d**: Four arbitrary `Field` values for custom data
- **randomness**: A random `Field` value to ensure note privacy
- **owner**: The `AztecAddress` of the note owner

## Contract Functions

### `insert(a: Field, b: Field, c: Field, d: Field)`

A private function that creates and stores a new custom note.

- **Parameters**: Four field values (a, b, c, d)
- **Behavior**: Creates a note with the provided values and assigns ownership to the message sender
- **Privacy**: Emits the note using unconstrained onchain message delivery

### `view_custom_notes(owner: AztecAddress)`

An unconstrained utility function to view all custom notes for a given owner.

- **Parameters**: Owner's Aztec address
- **Returns**: Array of custom notes (up to `MAX_NOTES_PER_PAGE`)
- **Usage**: Can be called to query notes without consuming gas

## Building

Compile the contract using the Aztec CLI:

```bash
aztec compile
```

## Usage Example

1. **Deploy the contract** to an Aztec network

2. **Insert a custom note**:

```rust
CustomNote.insert(field1, field2, field3, field4)
```

3. **View notes for an address**:

```rust
CustomNote.view_custom_notes(owner_address)
```

## Key Features

- Demonstrates custom note type implementation with the `#[note]` macro
- Shows how to use `PrivateSet` storage for managing multiple notes per user
- Implements proper note privacy using randomness
- Provides getter methods for accessing individual note fields

## Dependencies

- Aztec v3.0.0-devnet.6-patch.1

To set this version:

```bash
aztec-up 3.0.0-devnet.6-patch.1
```

## Project Structure

```
custom-note/
├── Nargo.toml           # Project configuration
└── src/
    ├── main.nr          # Main contract implementation
    └── custom_note.nr   # Custom note type definition
```

## Learn More

- [Aztec Documentation](https://docs.aztec.network/)
- [Noir Language Documentation](https://noir-lang.org/)
