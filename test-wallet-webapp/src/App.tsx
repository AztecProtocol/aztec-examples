import { useState } from 'react'
import './App.css'
import { setLogCallback } from './consoleInterceptor'
import { createAztecNodeClient } from '@aztec/aztec.js/node'

import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { getPXEConfig } from '@aztec/pxe/client/lazy';
import { TestWallet } from '@aztec/test-wallet/client/lazy';

import {PrivateVotingContract} from '@aztec/noir-contracts.js/PrivateVoting';
import { AztecAddress } from '@aztec/aztec.js/addresses'
import type { TestWallet as TestWalletType } from '@aztec/test-wallet/client/lazy';

function App() {
  const [output, setOutput] = useState<string[]>([])
  const [isCreatingWallet, setIsCreatingWallet] = useState(false)
  const [isDeployingContract, setIsDeployingContract] = useState(false)
  const [isCastingVote, setIsCastingVote] = useState(false)
  const [wallet, setWallet] = useState<TestWalletType | null>(null)
  const [address, setAddress] = useState<AztecAddress | null>(null)
  const [contractAddress, setContractAddress] = useState<AztecAddress | null>(null)

  const createTestWalletAndSchnorrAccount = async () => {
    setIsCreatingWallet(true)
    setOutput([])

    // Set up callback to capture logs
    setLogCallback((prefix, message) => {
      setOutput(prev => [...prev, `${prefix} ${message}`])
    })

    try {
      const nodeURL = 'http://localhost:8080';

      const aztecNode = await createAztecNodeClient(nodeURL);
      const config = getPXEConfig();
      config.dataDirectory = 'pxe';
      const newWallet = await TestWallet.create(aztecNode, config);

      const [accountData] = await getInitialTestAccountsData();
      if (!accountData) {
        console.error(
          'Account not found. Please connect the app to a testing environment with deployed and funded test accounts.',
        );
        return;
      }

      const accountManager = await newWallet.createSchnorrAccount(accountData.secret, accountData.salt, accountData.signingKey);
      const accountAddress = accountManager.address;

      // Save wallet and address to state
      setWallet(newWallet);
      setAddress(accountAddress);

      console.log('Wallet created! Address:', accountAddress.toString());
    } catch (error) {
      console.error('Error during execution:', error)
    } finally {
      // Remove callback when done
      setLogCallback(null)
      setIsCreatingWallet(false)
    }
  };

  const deployContract = async () => {
    if (!wallet || !address) {
      console.error('Wallet not initialized. Please create wallet first.');
      return;
    }

    setIsDeployingContract(true);
    setOutput([]);

    // Set up callback to capture logs
    setLogCallback((prefix, message) => {
      setOutput(prev => [...prev, `${prefix} ${message}`])
    })

    try {
      const deployedContract = await PrivateVotingContract.deploy(
        wallet,
        address,
      )
        .send({ from: address })
        .deployed();

      setContractAddress(deployedContract.address);

      console.log('Contract deployed at:', deployedContract.address.toString());
    } catch (error) {
      console.error('Error during execution:', error)
    } finally {
      // Remove callback when done
      setLogCallback(null)
      setIsDeployingContract(false)
    }
  };

  const castVote = async () => {
    if (!wallet || !address || !contractAddress) {
      console.error('Wallet, address, or contract not initialized. Please deploy contract first.');
      return;
    }

    setIsCastingVote(true);
    setOutput([]);

    // Set up callback to capture logs
    setLogCallback((prefix, message) => {
      setOutput(prev => [...prev, `${prefix} ${message}`])
    })

    try {
      const contract = await PrivateVotingContract.at(contractAddress, wallet);
      await contract.methods.cast_vote(1n).send({
        from: address
      }).wait();

      console.log('Vote cast successfully!');
    } catch (error) {
      console.error('Error during execution:', error)
    } finally {
      // Remove callback when done
      setLogCallback(null)
      setIsCastingVote(false)
    }
  };

  return (
    <>
      <h1>Private Voting in the Browser</h1>
      <div className="card" style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '24px',
          justifyContent: 'center',
          padding: '0 20px'
        }}>
          <button
            onClick={createTestWalletAndSchnorrAccount}
            disabled={isCreatingWallet || !!wallet}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: '500',
              borderRadius: '6px',
              cursor: (isCreatingWallet || !!wallet) ? 'not-allowed' : 'pointer',
              opacity: (isCreatingWallet || !!wallet) ? 0.6 : 1
            }}
          >
            {isCreatingWallet ? 'Creating...' : wallet ? '✓ Wallet Created' : '1. Create Wallet'}
          </button>
          <button
            onClick={deployContract}
            disabled={isDeployingContract || !wallet || !!contractAddress}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: '500',
              borderRadius: '6px',
              cursor: (isDeployingContract || !wallet || !!contractAddress) ? 'not-allowed' : 'pointer',
              opacity: (isDeployingContract || !wallet || !!contractAddress) ? 0.6 : 1
            }}
          >
            {isDeployingContract ? 'Deploying...' : contractAddress ? '✓ Contract Deployed' : '2. Deploy Contract'}
          </button>
          <button
            onClick={castVote}
            disabled={isCastingVote || !contractAddress}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: '500',
              borderRadius: '6px',
              cursor: (isCastingVote || !contractAddress) ? 'not-allowed' : 'pointer',
              opacity: (isCastingVote || !contractAddress) ? 0.6 : 1
            }}
          >
            {isCastingVote ? 'Casting...' : '3. Cast Vote'}
          </button>
        </div>

        <div style={{
          marginTop: '24px',
          padding: '20px',
          backgroundColor: '#0a0a0a',
          borderRadius: '8px',
          textAlign: 'left',
          height: '50vh',
          width: '50vw',
          maxWidth: '100%',
          overflow: 'auto',
          border: '1px solid #2a2a2a',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
          margin: '0 auto'
        }}>
          <h3 style={{
            marginTop: 0,
            marginBottom: '16px',
            color: '#e0e0e0',
            fontSize: '16px',
            fontWeight: '600',
            borderBottom: '1px solid #2a2a2a',
            paddingBottom: '12px'
          }}>
            Console Output
          </h3>
          {output.length === 0 ? (
            <p style={{
              color: '#666',
              fontStyle: 'italic',
              textAlign: 'center',
              marginTop: '40px'
            }}>
              No output yet. Click a button to begin.
            </p>
          ) : (
            <div>
              {output.map((line, index) => (
                <div key={index} style={{
                  fontFamily: 'Monaco, Menlo, "Courier New", monospace',
                  fontSize: '11px',
                  lineHeight: '1.6',
                  margin: '4px 0',
                  padding: '4px 8px',
                  borderRadius: '3px',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  color: line.startsWith('[ERROR]') ? '#ff6b6b' :
                         line.startsWith('[WARN]') ? '#ffa500' :
                         line.startsWith('[INFO]') ? '#64b5f6' :
                         line.startsWith('[DEBUG]') ? '#9c27b0' :
                         line.startsWith('[TRACE]') ? '#757575' : '#4ade80',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word'
                }}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default App
