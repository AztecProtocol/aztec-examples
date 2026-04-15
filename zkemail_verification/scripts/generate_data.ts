import { Noir } from '@aztec/noir-noir_js';
import circuitJson from '../circuit/target/icloud_email_verifier.json' with { type: "json" }
import { Barretenberg, UltraHonkBackend, deflattenFields } from '@aztec/bb.js';
import fs from 'fs'
import { exit } from 'process';

// =============================================================================
// Test data from zkemail.nr/lib/src/tests/test_inputs.nr (EmailLarge module)
// Email from: runnier.leagues.0j@icloud.com
// Email to: zkewtest@gmail.com
// Subject: Bitcoin
// DKIM timestamp: 1712141644
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

// =============================================================================
// Compute header field positions programmatically
// =============================================================================

function findHeaderField(headerBytes: number[], fieldName: string): { index: number; length: number } {
  const nameBytes = Array.from(fieldName).map(c => c.charCodeAt(0));
  const colon = 58; // ':'
  const cr = 13;    // '\r'
  const lf = 10;    // '\n'

  for (let i = 0; i < headerBytes.length; i++) {
    // Check start-of-line: either i==0 or preceded by \r\n
    const atLineStart = i === 0 || (i >= 2 && headerBytes[i - 2] === cr && headerBytes[i - 1] === lf);
    if (!atLineStart) continue;

    // Check field name match (case-insensitive per RFC 5322)
    let match = true;
    for (let j = 0; j < nameBytes.length; j++) {
      // Compare lowercase: ASCII uppercase A-Z (65-90) -> lowercase a-z (97-122)
      const hb = headerBytes[i + j];
      const nb = nameBytes[j];
      const hbLower = (hb >= 65 && hb <= 90) ? hb + 32 : hb;
      const nbLower = (nb >= 65 && nb <= 90) ? nb + 32 : nb;
      if (hbLower !== nbLower) { match = false; break; }
    }
    if (!match || headerBytes[i + nameBytes.length] !== colon) continue;

    // Find end of field (next \r\n)
    let end = i + nameBytes.length + 1;
    while (end < headerBytes.length - 1 && !(headerBytes[end] === cr && headerBytes[end + 1] === lf)) {
      end++;
    }
    return { index: i, length: end - i };
  }
  throw new Error(`Header field "${fieldName}" not found`);
}

function findEmailAddressInField(headerBytes: number[], fieldSeq: { index: number; length: number }, fieldName: string): { index: number; length: number } {
  // Address starts after "fieldname:"
  const valueStart = fieldSeq.index + fieldName.length + 1;
  const valueEnd = fieldSeq.index + fieldSeq.length;

  // Check for angle-bracket format: "Display Name <addr>"
  let addrStart = valueStart;
  let addrEnd = valueEnd;
  for (let i = valueStart; i < valueEnd; i++) {
    if (headerBytes[i] === 60) addrStart = i + 1; // '<'
    if (headerBytes[i] === 62) addrEnd = i;        // '>'
  }
  return { index: addrStart, length: addrEnd - addrStart };
}

function findDkimTimestampIndex(headerBytes: number[], dkimSeq: { index: number; length: number }): number {
  // Search for "; t=" or " t=" within the DKIM header field
  const dkimEnd = dkimSeq.index + dkimSeq.length;
  for (let i = dkimSeq.index; i < dkimEnd - 2; i++) {
    if (headerBytes[i] === 116 && headerBytes[i + 1] === 61) { // 't' '='
      // Verify preceded by '; ' or ' '
      if (i > 0 && (headerBytes[i - 1] === 32 || headerBytes[i - 1] === 59)) {
        // Verify followed by a digit
        if (headerBytes[i + 2] >= 48 && headerBytes[i + 2] <= 57) {
          return i + 2; // index of first digit
        }
      }
    }
  }
  throw new Error("DKIM timestamp (t=) tag not found in DKIM-Signature header");
}

// Compute all header field positions
const fromSeq = findHeaderField(HEADER_BYTES, "from");
const fromAddrSeq = findEmailAddressInField(HEADER_BYTES, fromSeq, "from");
const toSeq = findHeaderField(HEADER_BYTES, "to");
const toAddrSeq = findEmailAddressInField(HEADER_BYTES, toSeq, "to");
const subjectSeq = findHeaderField(HEADER_BYTES, "subject");
const dkimSeq = findHeaderField(HEADER_BYTES, "dkim-signature");
const dkimTimestampIndex = findDkimTimestampIndex(HEADER_BYTES, dkimSeq);

console.log("Header field positions:");
console.log(`  from: index=${fromSeq.index}, length=${fromSeq.length}`);
console.log(`  from address: index=${fromAddrSeq.index}, length=${fromAddrSeq.length} (${String.fromCharCode(...HEADER_BYTES.slice(fromAddrSeq.index, fromAddrSeq.index + fromAddrSeq.length))})`);
console.log(`  to: index=${toSeq.index}, length=${toSeq.length}`);
console.log(`  to address: index=${toAddrSeq.index}, length=${toAddrSeq.length} (${String.fromCharCode(...HEADER_BYTES.slice(toAddrSeq.index, toAddrSeq.index + toAddrSeq.length))})`);
console.log(`  subject: index=${subjectSeq.index}, length=${subjectSeq.length} (${String.fromCharCode(...HEADER_BYTES.slice(subjectSeq.index + 8, subjectSeq.index + subjectSeq.length))})`);
console.log(`  dkim: index=${dkimSeq.index}, length=${dkimSeq.length}`);
console.log(`  dkim timestamp digit start: index=${dkimTimestampIndex}`);

// =============================================================================
// Build circuit inputs
// =============================================================================

function padArray(arr: number[], maxLen: number): string[] {
  return [...arr.map(b => b.toString()), ...Array(maxLen - arr.length).fill("0")];
}

const inputs = {
  header: {
    storage: padArray(HEADER_BYTES, MAX_HEADER_LENGTH),
    len: HEADER_BYTES.length.toString(),
  },
  pubkey: {
    modulus: MODULUS_LIMBS,
    redc: REDC_LIMBS,
  },
  signature: SIGNATURE_LIMBS,
  dkim_header_sequence: { index: dkimSeq.index.toString(), length: dkimSeq.length.toString() },
  from_header_sequence: { index: fromSeq.index.toString(), length: fromSeq.length.toString() },
  from_address_sequence: { index: fromAddrSeq.index.toString(), length: fromAddrSeq.length.toString() },
  to_header_sequence: { index: toSeq.index.toString(), length: toSeq.length.toString() },
  to_address_sequence: { index: toAddrSeq.index.toString(), length: toAddrSeq.length.toString() },
  subject_header_sequence: { index: subjectSeq.index.toString(), length: subjectSeq.length.toString() },
  dkim_timestamp_index: dkimTimestampIndex.toString(),
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

// Log public input meanings
console.log("\nPublic inputs breakdown:");
console.log(`  [0] pubkey_hash[0]:   ${proofData.publicInputs[0]}`);
console.log(`  [1] pubkey_hash[1]:   ${proofData.publicInputs[1]}`);
console.log(`  [2] email_nullifier:  ${proofData.publicInputs[2]}`);
console.log(`  [3] to_address_hash:  ${proofData.publicInputs[3]}`);
console.log(`  [4] intent_hash:      ${proofData.publicInputs[4]}`);
console.log(`  [5] dkim_timestamp:   ${proofData.publicInputs[5]}`);

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
