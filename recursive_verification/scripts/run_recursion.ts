import { AccountWalletWithSecretKey, Contract, createPXEClient, waitForPXE, type FieldLike, type PXE } from "@aztec/aztec.js"

export const PXE_URL = 'http://localhost:8080'
import { getInitialTestAccountsWallets } from '@aztec/accounts/testing'
import { ValueNotEqualContract, ValueNotEqualContractArtifact } from '../contract/artifacts/ValueNotEqual'
import data from '../data.json'

export const setupSandbox = async (): Promise<PXE> => {
  try {
    console.log(`Setting up sandbox with PXE URL: ${PXE_URL}`)
    const pxe = await createPXEClient(PXE_URL)
    await waitForPXE(pxe)
    console.log('PXE client created and connected successfully')
    return pxe
  } catch (error) {
    console.error('Failed to setup sandbox:', error)
    throw error
  }
}
export interface TestWallets {
  owner: AccountWalletWithSecretKey
  user1: AccountWalletWithSecretKey
  user2: AccountWalletWithSecretKey
  user3: AccountWalletWithSecretKey
}

export const setupWallets = async (pxe: PXE): Promise<TestWallets> => {
  try {
    console.log('Setting up test wallets')
    const wallets = await getInitialTestAccountsWallets(pxe)

    const testWallets: TestWallets = {
      owner: wallets[0],
      user1: wallets[1],
      user2: wallets[2],
      //? Here wallet[3] is always coming wallets[0], so please keep this in mind
      user3: wallets[3] || wallets[0], // Fallback if not enough wallets
    }

    console.log('Test wallets configured')
    console.info('Owner address:', testWallets.owner.getAddress().toString())
    console.info('User1 address:', testWallets.user1.getAddress().toString())
    console.info('User2 address:', testWallets.user2.getAddress().toString())

    return testWallets
  } catch (error) {
    console.error('Failed to setup wallets:', error)
    throw error
  }
}

async function main() {
  const pxe = await setupSandbox();
  const wallets = await setupWallets(pxe)

  const valueNotEqual = await Contract.deploy(wallets.owner, ValueNotEqualContractArtifact, [
    10, wallets.owner.getAddress()
  ], 'initialize').send({ from: wallets.owner.getAddress() }).deployed() as ValueNotEqualContract

  console.log("Contract Deployed at address", valueNotEqual.address.toString())

  const tx = await valueNotEqual.methods.increment(wallets.owner.getAddress(), data.vkAsFields as unknown as FieldLike[], data.proofAsFields as unknown as FieldLike[], data.publicInputs as unknown as FieldLike[]).send({ from: wallets.owner.getAddress() }).wait()

  console.log(`Tx hash: ${tx.txHash.toString()}`)
  const counterValue = await valueNotEqual.methods.get_counter(wallets.owner.getAddress()).simulate({ from: wallets.owner.getAddress() })
  console.log(`Counter value: ${counterValue}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
