import { createPXEClient, waitForPXE } from '@aztec/aztec.js';
import { StarterTokenContract } from '../artifacts/StarterToken.js';
import { getInitialTestAccountsWallets } from '@aztec/accounts/testing';

const pxe = createPXEClient('http://localhost:8080');
await waitForPXE(pxe);

const wallets = await getInitialTestAccountsWallets(pxe);
const deployerWallet = wallets[0];
const deployerAddress = deployerWallet.getAddress();

const starterTokenContract = await StarterTokenContract
  .deploy(deployerWallet)
  .send({
    from: deployerAddress
  }).wait();

console.log(starterTokenContract.contract.address);
