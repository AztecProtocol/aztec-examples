import { Noir } from '@aztec/noir-noir_js';
import circuitJson from '../circuit/target/hello_circuit.json' with { type: "json" }
import { Barretenberg, deflattenFields, UltraHonkBackend } from '@aztec/bb.js';
import fs from 'fs'
import { exit } from 'process';

const helloWorld = new Noir(circuitJson as any)

const { witness: mainWitness } = await helloWorld.execute({ x: 1, y: 2 })

const mainBackend = new UltraHonkBackend(circuitJson.bytecode, { threads: 1 })
const mainProofData = await mainBackend.generateProof(mainWitness)

let recursiveProofArtifacts = await mainBackend.generateRecursiveProofArtifacts(mainProofData.proof, 1)

const isValid = await mainBackend.verifyProof(mainProofData)
console.log(`Proof verification: ${isValid ? 'SUCCESS' : 'FAILED'}`)

const proofAsFields = deflattenFields(mainProofData.proof)
const barretenbergAPI = await Barretenberg.new({ threads: 1 });

// write recursive proof artifacts and public inputs to file, add pu
fs.writeFileSync('data.json', JSON.stringify({ ...recursiveProofArtifacts, proofAsFields, publicInputs: mainProofData.publicInputs }, null, 2))
await barretenbergAPI.destroy()
console.log("Done")
exit()
