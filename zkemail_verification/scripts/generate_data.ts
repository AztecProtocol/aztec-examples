import { Noir } from '@aztec/noir-noir_js';
import circuitJson from '../circuit/target/icloud_email_verifier.json' with { type: "json" }
import { Barretenberg, UltraHonkBackend, deflattenFields } from '@aztec/bb.js';
import fs from 'fs'
import { exit } from 'process';

// =============================================================================
// Test data from zkemail.nr/lib/src/tests/test_inputs.nr (EmailLarge module)
// Email from: runnier.leagues.0j@icloud.com
// =============================================================================

const HEADER_BYTES = [
  102, 114, 111, 109, 58, 114, 117, 110, 110, 105, 101, 114, 46, 108, 101, 97, 103, 117, 101,
  115, 46, 48, 106, 64, 105, 99, 108, 111, 117, 100, 46, 99, 111, 109, 13, 10, 99, 111, 110,
  116, 101, 110, 116, 45, 116, 121, 112, 101, 58, 116, 101, 120, 116, 47, 112, 108, 97, 105,
  110, 59, 32, 99, 104, 97, 114, 115, 101, 116, 61, 117, 116, 102, 45, 56, 13, 10, 109, 105,
  109, 101, 45, 118, 101, 114, 115, 105, 111, 110, 58, 49, 46, 48, 32, 40, 77, 97, 99, 32, 79,
  83, 32, 88, 32, 77, 97, 105, 108, 32, 49, 54, 46, 48, 32, 92, 40, 51, 55, 51, 49, 46, 53,
  48, 48, 46, 50, 51, 49, 92, 41, 41, 13, 10, 115, 117, 98, 106, 101, 99, 116, 58, 66, 105,
  116, 99, 111, 105, 110, 13, 10, 109, 101, 115, 115, 97, 103, 101, 45, 105, 100, 58, 60, 49,
  50, 56, 48, 48, 65, 57, 48, 45, 52, 69, 67, 67, 45, 52, 53, 49, 51, 45, 57, 50, 57, 56, 45,
  65, 51, 51, 53, 52, 54, 49, 50, 50, 57, 50, 48, 64, 109, 101, 46, 99, 111, 109, 62, 13, 10,
  100, 97, 116, 101, 58, 87, 101, 100, 44, 32, 51, 32, 65, 112, 114, 32, 50, 48, 50, 52, 32,
  49, 54, 58, 50, 51, 58, 52, 56, 32, 43, 48, 53, 51, 48, 13, 10, 116, 111, 58, 122, 107, 101,
  119, 116, 101, 115, 116, 64, 103, 109, 97, 105, 108, 46, 99, 111, 109, 13, 10, 100, 107,
  105, 109, 45, 115, 105, 103, 110, 97, 116, 117, 114, 101, 58, 118, 61, 49, 59, 32, 97, 61,
  114, 115, 97, 45, 115, 104, 97, 50, 53, 54, 59, 32, 99, 61, 114, 101, 108, 97, 120, 101,
  100, 47, 114, 101, 108, 97, 120, 101, 100, 59, 32, 100, 61, 105, 99, 108, 111, 117, 100, 46,
  99, 111, 109, 59, 32, 115, 61, 49, 97, 49, 104, 97, 105, 59, 32, 116, 61, 49, 55, 49, 50,
  49, 52, 49, 54, 52, 52, 59, 32, 98, 104, 61, 50, 74, 115, 100, 75, 52, 66, 77, 122, 122,
  116, 57, 119, 52, 90, 108, 122, 50, 84, 100, 121, 86, 67, 70, 99, 43, 108, 55, 118, 78, 121,
  84, 53, 97, 65, 103, 71, 68, 89, 102, 55, 102, 77, 61, 59, 32, 104, 61, 102, 114, 111, 109,
  58, 67, 111, 110, 116, 101, 110, 116, 45, 84, 121, 112, 101, 58, 77, 105, 109, 101, 45, 86,
  101, 114, 115, 105, 111, 110, 58, 83, 117, 98, 106, 101, 99, 116, 58, 77, 101, 115, 115, 97,
  103, 101, 45, 73, 100, 58, 68, 97, 116, 101, 58, 116, 111, 59, 32, 98, 61,
];

const BODY_BYTES = [
  84, 104, 101, 32, 84, 105, 109, 101, 115, 32, 48, 51, 47, 74, 97, 110, 47, 50, 48, 48, 57,
  32, 67, 104, 97, 110, 99, 101, 108, 108, 111, 114, 32, 111, 110, 32, 98, 114, 105, 110, 107,
  32, 111, 102, 32, 115, 101, 99, 111, 110, 100, 32, 98, 97, 105, 108, 111, 117, 116, 32, 102,
  111, 114, 32, 98, 97, 110, 107, 115, 13, 10, 13, 10, 49, 53, 32, 121, 101, 97, 114, 115, 32,
  97, 103, 111, 44, 32, 83, 97, 116, 111, 115, 104, 105, 32, 109, 105, 110, 101, 100, 32, 116,
  104, 101, 32, 102, 105, 114, 115, 116, 32, 98, 108, 111, 99, 107, 32, 111, 102, 32, 116,
  104, 101, 32, 66, 105, 116, 99, 111, 105, 110, 32, 98, 108, 111, 99, 107, 99, 104, 97, 105,
  110, 32, 61, 13, 10, 65, 102, 116, 101, 114, 32, 116, 104, 101, 32, 66, 105, 116, 99, 111,
  105, 110, 32, 119, 104, 105, 116, 101, 32, 112, 97, 112, 101, 114, 32, 97, 112, 112, 101,
  97, 114, 101, 100, 32, 111, 110, 32, 79, 99, 116, 111, 98, 101, 114, 32, 51, 49, 44, 32, 50,
  48, 48, 56, 44, 32, 111, 110, 32, 97, 32, 61, 13, 10, 99, 114, 121, 112, 116, 111, 103, 114,
  97, 112, 104, 121, 32, 109, 97, 105, 108, 105, 110, 103, 32, 108, 105, 115, 116, 44, 32,
  116, 104, 101, 32, 71, 101, 110, 101, 115, 105, 115, 32, 66, 108, 111, 99, 107, 32, 61, 69,
  50, 61, 56, 48, 61, 57, 52, 32, 116, 104, 101, 32, 102, 105, 114, 115, 116, 32, 98, 105,
  116, 99, 111, 105, 110, 32, 61, 13, 10, 98, 108, 111, 99, 107, 32, 97, 110, 100, 32, 116,
  104, 101, 32, 98, 97, 115, 105, 115, 32, 111, 102, 32, 116, 104, 101, 32, 101, 110, 116,
  105, 114, 101, 32, 66, 105, 116, 99, 111, 105, 110, 32, 116, 114, 97, 100, 105, 110, 103,
  32, 115, 121, 115, 116, 101, 109, 32, 105, 110, 32, 112, 108, 97, 99, 101, 32, 116, 111, 32,
  61, 13, 10, 116, 104, 105, 115, 32, 100, 97, 121, 32, 61, 69, 50, 61, 56, 48, 61, 57, 52,
  32, 119, 97, 115, 32, 109, 105, 110, 101, 100, 32, 111, 110, 32, 74, 97, 110, 117, 97, 114,
  121, 32, 51, 44, 32, 50, 48, 48, 57, 46, 61, 50, 48, 13, 10, 13, 10, 84, 104, 101, 32, 71,
  101, 110, 101, 115, 105, 115, 32, 66, 108, 111, 99, 107, 32, 105, 115, 32, 97, 108, 115,
  111, 32, 107, 110, 111, 119, 110, 32, 97, 115, 32, 66, 108, 111, 99, 107, 32, 48, 32, 111,
  114, 32, 66, 108, 111, 99, 107, 32, 49, 44, 32, 97, 110, 100, 32, 105, 115, 32, 115, 116,
  105, 108, 108, 32, 105, 110, 32, 61, 13, 10, 116, 104, 101, 32, 66, 105, 116, 99, 111, 105,
  110, 32, 110, 101, 116, 119, 111, 114, 107, 44, 32, 119, 104, 101, 114, 101, 32, 105, 116,
  32, 119, 105, 108, 108, 32, 114, 101, 109, 97, 105, 110, 32, 97, 115, 32, 108, 111, 110,
  103, 32, 97, 115, 32, 116, 104, 101, 114, 101, 32, 105, 115, 32, 97, 32, 99, 111, 109, 112,
  117, 116, 101, 114, 32, 61, 13, 10, 114, 117, 110, 110, 105, 110, 103, 32, 116, 104, 101,
  32, 66, 105, 116, 99, 111, 105, 110, 32, 115, 111, 102, 116, 119, 97, 114, 101, 46, 61, 50,
  48, 13, 10, 13, 10, 65, 108, 108, 32, 110, 111, 100, 101, 115, 32, 105, 110, 32, 116, 104,
  101, 32, 66, 105, 116, 99, 111, 105, 110, 32, 110, 101, 116, 119, 111, 114, 107, 32, 99, 97,
  110, 32, 99, 111, 110, 115, 117, 108, 116, 32, 105, 116, 44, 32, 101, 118, 101, 110, 32,
  105, 102, 32, 105, 116, 32, 105, 115, 32, 97, 116, 32, 116, 104, 101, 32, 61, 13, 10, 111,
  116, 104, 101, 114, 32, 101, 110, 100, 32, 111, 102, 32, 116, 104, 101, 32, 110, 101, 116,
  119, 111, 114, 107, 32, 119, 105, 116, 104, 32, 104, 117, 110, 100, 114, 101, 100, 115, 32,
  111, 102, 32, 116, 104, 111, 117, 115, 97, 110, 100, 115, 32, 111, 102, 32, 98, 108, 111,
  99, 107, 115, 46, 13, 10,
];

// RSA public key modulus limbs (18 x 120-bit)
const MODULUS_LIMBS = [
  "0xe5cf995b5ef59ce9943d1f4209b6ab",
  "0xe0caf03235e91a2db27e9ed214bcc6",
  "0xafe1309f87414bd36ed296dacfade2",
  "0xbeff3f19046a43adce46c932514988",
  "0x324041af8736e87de4358860fff057",
  "0xadcc6669dfa346f322717851a8c22a",
  "0x8b2a193089e6bf951c553b5a6f71aa",
  "0x0a570fe582918c4f731a0002068df2",
  "0x39419a433d6bfdd1978356cbca4b60",
  "0x550d695a514d38b45c862320a00ea5",
  "0x1c56ac1dfbf1beea31e8a613c2a51f",
  "0x6a30c9f22d2e5cb6934263d0838809",
  "0x0a281f268a44b21a4f77a91a52f960",
  "0x5134dc3966c8e91402669a47cc8597",
  "0x71590781df114ec072e641cdc5d224",
  "0xa1bc0f0937489c806c1944fd029dc9",
  "0x911f6e47f84db3b64c3648ebb5a127",
  "0xd5",
];

// RSA public key redc parameter limbs (Barrett reduction, OVERFLOW_BITS=6)
const REDC_LIMBS = [
  "0x22a09393af1f83c4167cfb3e95f118",
  "0x7076c8fcf1f51eb5f9f5f3f6946269",
  "0x6edaeef63eb3c047c08bea4146bb01",
  "0x3ea933bd1d2fb58e4d8ba9c7de885e",
  "0x40ea942ddf892c0c21069f41856049",
  "0xefd398a01786182a41303d9a97eb45",
  "0x2f492dc910b4b3991f75f42910da16",
  "0xd2a20e69118305a7739c4e3bf6bbd7",
  "0xc1b8278c646e656c2396d1460bd941",
  "0x7eb52a27e0da7f8439752db8526843",
  "0x1de2c5660b447afdff88ed3857c414",
  "0x27fce9159c1dd44311d392b02886b7",
  "0xdf9a7976eddc59edcc1979316b5aa8",
  "0x3d1dd388b9ff8e8e190861bdeb9d2c",
  "0xb9cad7ad3204e8ecde66020eaae07b",
  "0x239c142aa2afb739691705a614dd85",
  "0x4ca1794ecc8ac887def3d3e3e2b629",
  "0x4cb7",
];

// DKIM signature limbs (18 x 120-bit)
const SIGNATURE_LIMBS = [
  "0xf193c3300b7c9902e32861c38d0d2d",
  "0x9f6927fdb3df0b84092d8459654327",
  "0x8a0bea5e2fa82821e49c27b68d5a7b",
  "0xaa8c0acc1190f9fd845ef64f8e7ae9",
  "0xa7aeebb37f4395965543e6df69a5a7",
  "0x087ecef9921569cfba83331ca11c6b",
  "0x4589ed316ed20757e65ad221736011",
  "0x0835d8748f11dcc985700c3fea27b1",
  "0xe870d2493fb83b4a1d72350e5de926",
  "0x268b28eda0aac07625cfab32b60af1",
  "0xb41a164eae7ba1602eaec5b5a39fe6",
  "0x693cc5ec578422bee48eabe390fc37",
  "0xa29504dd504f14423f2ce65b2ac388",
  "0x6c3ac6310c084a0b126fcd5225c208",
  "0xab0903e48563e5f4a5365ac5cbd888",
  "0xf05bf2e5b6266c0ac88dfc733c414f",
  "0xf58f9e9669e0f4f3086cce1187fd44",
  "0xb9",
];

const MAX_HEADER_LENGTH = 512;
const MAX_BODY_LENGTH = 1024;

// =============================================================================
// Build circuit inputs
// =============================================================================

// Pad arrays to max length with zeros
function padArray(arr: number[], maxLen: number): string[] {
  const padded = [...arr.map(b => b.toString()), ...Array(maxLen - arr.length).fill("0")];
  return padded;
}

const inputs = {
  header: {
    storage: padArray(HEADER_BYTES, MAX_HEADER_LENGTH),
    len: HEADER_BYTES.length.toString(),
  },
  body: {
    storage: padArray(BODY_BYTES, MAX_BODY_LENGTH),
    len: BODY_BYTES.length.toString(),
  },
  pubkey: {
    modulus: MODULUS_LIMBS,
    redc: REDC_LIMBS,
  },
  signature: SIGNATURE_LIMBS,
  body_hash_index: "361",
  dkim_header_sequence: { index: "267", length: "203" },
  from_header_sequence: { index: "0", length: "34" },
  from_address_sequence: { index: "5", length: "29" },
};

// =============================================================================
// Generate proof
// =============================================================================

console.log("Initializing Barretenberg...");
const barretenbergAPI = await Barretenberg.new({ threads: 1 });

const noir = new Noir(circuitJson as any);

console.log("Executing circuit (generating witness)...");
const { witness } = await noir.execute(inputs);
console.log("Witness generated successfully");

const backend = new UltraHonkBackend(circuitJson.bytecode, barretenbergAPI);

console.log("Generating UltraHonk proof (this may take several minutes)...");
const proofData = await backend.generateProof(witness, {
  verifierTarget: 'noir-recursive'
});
console.log("Proof generated successfully");

// Verify proof off-chain
console.log("Verifying proof off-chain...");
const isValid = await backend.verifyProof(proofData, {
  verifierTarget: 'noir-recursive'
});
console.log(`Off-chain proof verification: ${isValid ? 'SUCCESS' : 'FAILED'}`);
if (!isValid) {
  console.error("FATAL: Proof verification failed off-chain. Aborting.");
  await barretenbergAPI.destroy();
  exit(1);
}

// Generate recursive proof artifacts
console.log("Generating recursive proof artifacts...");
const recursiveArtifacts = await backend.generateRecursiveProofArtifacts(
  proofData.proof,
  proofData.publicInputs.length
);

// Handle proofAsFields fallback (same as reference)
let proofAsFields = recursiveArtifacts.proofAsFields;
if (proofAsFields.length === 0) {
  console.log('Using deflattenFields to convert proof...');
  proofAsFields = deflattenFields(proofData.proof).map(f => f.toString());
}

const vkAsFields = recursiveArtifacts.vkAsFields;

console.log(`VK size: ${vkAsFields.length}`);
console.log(`Proof size: ${proofAsFields.length}`);
console.log(`Public inputs: ${proofData.publicInputs.length}`);

// Write data.json
const data = {
  vkAsFields: vkAsFields,
  vkHash: recursiveArtifacts.vkHash,
  proofAsFields: proofAsFields,
  publicInputs: proofData.publicInputs.map((p: string) => p.toString()),
};

fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
console.log("data.json written successfully");

await barretenbergAPI.destroy();
console.log("Done");
exit();
