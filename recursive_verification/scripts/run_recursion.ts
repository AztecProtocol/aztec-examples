import { AccountWalletWithSecretKey, Contract, createAztecNodeClient, Fq, Fr, SponsoredFeePaymentMethod, waitForPXE, type FieldLike, type PXE } from "@aztec/aztec.js"
import { getSponsoredFPCInstance } from "./sponsored_fpc.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
export const PXE_URL = 'http://localhost:8080'
import { ValueNotEqualContract, ValueNotEqualContractArtifact } from '../contract/artifacts/ValueNotEqual'
import data from '../data.json'
import { createPXEService, getPXEServiceConfig } from "@aztec/pxe/server"
import { createStore } from "@aztec/kv-store/lmdb"
import { getSchnorrAccount } from "@aztec/accounts/schnorr"

const sponsoredFPC = await getSponsoredFPCInstance();
const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

export const setupSandbox = async (): Promise<PXE> => {
  try {
    const nodeUrl = 'http://localhost:8080';
    const node = await createAztecNodeClient(nodeUrl);
    
    try {
        await node.getNodeInfo();
    } catch (error) {
        throw new Error(`Cannot connect to node at ${nodeUrl}. ${nodeUrl.includes('localhost') ? 'Please run: aztec start --sandbox' : 'Check your connection.'}`);
    }

    const l1Contracts = await node.getL1ContractAddresses();
    const config = getPXEServiceConfig();
    const fullConfig = { 
        ...config, 
        l1Contracts, 
        proverEnabled: true 
    };

    const store = await createStore('recursive_verification', {
      dataDirectory: 'store',
      dataStoreMapSizeKB: 1e6,
    });

    const pxe = await createPXEService(node, fullConfig, { store });
    await waitForPXE(pxe);
    await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
    
    return pxe;
  } catch (error) {
    console.error('Failed to setup sandbox:', error)
    throw error
  }
}

export async function deployWallet(pxe: PXE): Promise<AccountWalletWithSecretKey> {
  let secretKey = Fr.random();
  let signingKey = Fq.random();
  let salt = Fr.random();
  let schnorrAccount = await getSchnorrAccount(pxe, secretKey, signingKey, salt);
  let tx = await schnorrAccount.deploy({ fee: { paymentMethod: sponsoredPaymentMethod } }).wait({ timeout: 120000 });
  let wallet = await schnorrAccount.getWallet();
  return wallet
}

async function main() {
  const pxe = await setupSandbox();
  const wallet = await deployWallet(pxe)

  const valueNotEqual = await Contract.deploy(wallet, ValueNotEqualContractArtifact, [
    10, wallet.getAddress()
  ], 'initialize').send({ from: wallet.getAddress(), fee: { paymentMethod: sponsoredPaymentMethod } }).deployed() as ValueNotEqualContract

  console.log("Contract Deployed at address", valueNotEqual.address.toString())

  const tx = await valueNotEqual.methods.increment(wallet.getAddress(), data.vkAsFields as unknown as FieldLike[], data.proofAsFields as unknown as FieldLike[], data.publicInputs as unknown as FieldLike[]).send({ from: wallet.getAddress(), fee: { paymentMethod: sponsoredPaymentMethod } }).wait()

  console.log(`Tx hash: ${tx.txHash.toString()}`)
  const counterValue = await valueNotEqual.methods.get_counter(wallet.getAddress()).simulate({ from: wallet.getAddress() })
  console.log(`Counter value: ${counterValue}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
