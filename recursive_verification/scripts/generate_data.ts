import { Noir } from '@aztec/noir-noir_js';
import circuitJson from '../circuit/target/hello_circuit.json' with { type: "json" }
import { Barretenberg, UltraHonkBackend, deflattenFields } from '@aztec/bb.js';
import fs from 'fs'
import { exit } from 'process';

// Initialize Barretenberg API first
const barretenbergAPI = await Barretenberg.new({ threads: 1 });

const helloWorld = new Noir(circuitJson as any)

// Execute the circuit to get the witness
const { witness: mainWitness } = await helloWorld.execute({ x: 1, y: 2 })

// Initialize backend - pass Barretenberg instance as second argument
const mainBackend = new UltraHonkBackend(circuitJson.bytecode, barretenbergAPI)

// Generate the proof with recursive verifier target
const mainProofData = await mainBackend.generateProof(mainWitness, {
  verifierTarget: 'noir-recursive'
})

// Verify the proof
const isValid = await mainBackend.verifyProof(mainProofData, {
  verifierTarget: 'noir-recursive'
})
console.log(`Proof verification: ${isValid ? 'SUCCESS' : 'FAILED'}`)

// Generate recursive proof artifacts (proof as fields, vk as fields, vk hash)
const recursiveArtifacts = await mainBackend.generateRecursiveProofArtifacts(
  mainProofData.proof,
  mainProofData.publicInputs.length
)

// If proofAsFields is empty, use deflattenFields to convert proof bytes to fields
let proofAsFields = recursiveArtifacts.proofAsFields;
if (proofAsFields.length === 0) {
  console.log('Using deflattenFields to convert proof...');
  proofAsFields = deflattenFields(mainProofData.proof).map(f => f.toString());
}

const vkAsFields = recursiveArtifacts.vkAsFields;

console.log(`VK size: ${vkAsFields.length}`);
console.log(`Proof size: ${proofAsFields.length}`);
console.log(`Public inputs: ${mainProofData.publicInputs.length}`);

// Write proof artifacts to file
const data = {
  vkAsFields: vkAsFields,
  vkHash: recursiveArtifacts.vkHash,
  proofAsFields: proofAsFields,
  publicInputs: mainProofData.publicInputs.map((p: string) => p.toString()),
};

fs.writeFileSync('data.json', JSON.stringify(data, null, 2))
await barretenbergAPI.destroy()
console.log("Done")
exit()
