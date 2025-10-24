import { Contract } from "@aztec/aztec.js/contracts"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import type { FieldLike } from "@aztec/aztec.js/abi"
import { getSponsoredFPCInstance } from "./sponsored_fpc.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
export const PXE_URL = 'http://localhost:8080'
import { ValueNotEqualContract, ValueNotEqualContractArtifact } from '../contract/artifacts/ValueNotEqual'
import data from '../data.json'
import { getPXEConfig } from "@aztec/pxe/config"
import { TestWallet } from '@aztec/test-wallet/server';
import { AztecAddress } from "@aztec/aztec.js/addresses"

const sponsoredFPC = await getSponsoredFPCInstance();
const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

export const setupSandbox = async (): Promise<TestWallet> => {

  try {
    const nodeUrl = 'http://localhost:8080';
    const aztecNode = await createAztecNodeClient(nodeUrl);
    const config = getPXEConfig();
    config.dataDirectory = 'pxe';
    config.proverEnabled = true;
    let wallet = await TestWallet.create(aztecNode, config);
    await wallet.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });

    return wallet;
  } catch (error) {
    console.error('Failed to setup sandbox:', error)
    throw error
  }
}


async function main() {
  const testWallet = await setupSandbox();
  const account = await testWallet.createAccount();
  const manager = await account.getDeployMethod();
  await manager.send({ from: AztecAddress.ZERO, fee: { paymentMethod: sponsoredPaymentMethod } }).deployed()
  const accounts = await testWallet.getAccounts();

  const valueNotEqual = await Contract.deploy(testWallet, ValueNotEqualContractArtifact, [
    10, accounts[0].item
  ], 'initialize').send({ from: accounts[0].item, fee: { paymentMethod: sponsoredPaymentMethod } }).deployed() as ValueNotEqualContract

  const tx = await valueNotEqual.methods.increment(accounts[0].item, data.vkAsFields as unknown as FieldLike[], data.proofAsFields as unknown as FieldLike[], data.publicInputs as unknown as FieldLike[]).send({ from: accounts[0].item, fee: { paymentMethod: sponsoredPaymentMethod } }).wait()

  console.log(`Tx hash: ${tx.txHash.toString()}`)
  const counterValue = await valueNotEqual.methods.get_counter(accounts[0].item).simulate({ from: accounts[0].item })
  console.log(`Counter value: ${counterValue}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
