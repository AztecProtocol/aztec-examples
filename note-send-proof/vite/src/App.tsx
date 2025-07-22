import { useState } from 'react'
import { UltraHonkBackend } from "@aztec/bb.js";
import circuit from "../../circuits/target/circuits.json" with { type: "json" };
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import './App.css'

interface GenerateProofInputs {
  settled_note_hash: string;
  contract_address: string;
  recipient: string;
  randomness: string;
  value: string;
  storage_slot: string;
  note_nonce: string;
}

interface GenerateProofResult {
  proof: Uint8Array;
  publicInputs: string[];
  verified: boolean;
  witness: Uint8Array;
}

interface VerifyProofInputs {
  proof: Uint8Array,
  public_inputs: string[]
}

interface VerifyProofResult {
  verified: boolean;
}

const createProof = async (inputs: GenerateProofInputs): Promise<GenerateProofResult> => {
  console.log('Generating proof...');

  const noir = new Noir(circuit as CompiledCircuit);
  const honk = new UltraHonkBackend(circuit.bytecode);

  const { witness } = await noir.execute({
    settled_note_hash: inputs.settled_note_hash,
    contract_address: inputs.contract_address,
    recipient: inputs.recipient,
    randomness: inputs.randomness,
    value: inputs.value,
    storage_slot: inputs.storage_slot,
    note_nonce: inputs.note_nonce,
  });

  const { proof, publicInputs } = await honk.generateProof(witness);

  const verified = await honk.verifyProof({ proof, publicInputs });

  return {
    proof,
    publicInputs,
    verified,
    witness
  };
};

const verifyProof = async (inputs: VerifyProofInputs): Promise<VerifyProofResult> => {
  console.log('Verifying proof...');

  const honk = new UltraHonkBackend(circuit.bytecode);
  const verified = await honk.verifyProof({
    proof: inputs.proof,
    publicInputs: inputs.public_inputs
  });

  return {
    verified,
  }
};

function App() {
  const [activeTab, setActiveTab] = useState<'generate' | 'verify'>('generate');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [formData, setFormData] = useState<GenerateProofInputs>({
    settled_note_hash: '',
    contract_address: '',
    recipient: '',
    randomness: '',
    value: '',
    storage_slot: '',
    note_nonce: '',
  });

  const [verifyData, setVerifyData] = useState({
    proof: '',
    publicInputs: '',
  });

  const [proofResult, setProofResult] = useState<GenerateProofResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ verified: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleVerifyInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setVerifyData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setProofResult(null);

    try {
      const result = await createProof(formData);
      setProofResult(result);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while generating the proof');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    setVerifyError(null);
    setVerifyResult(null);

    try {
      const result = await verifyProof({
        proof: new Uint8Array(verifyData.proof.split(',').map(x => parseInt(x.trim()))),
        public_inputs: JSON.parse(verifyData.publicInputs),
      });
      setVerifyResult(result);

    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'An error occurred while verifying the proof');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleTabChange = (newTab: 'generate' | 'verify') => {
    if (newTab === activeTab) return;

    setIsTransitioning(true);
    setTimeout(() => {
      setActiveTab(newTab);
      setIsTransitioning(false);
    }, 200);
  };

  return (
    <div className="app-container">
      <h1>Aztec Note Send Proof</h1>

      <div className="tab-buttons">
        <button
          className={`tab-button ${activeTab === 'generate' ? 'active' : ''}`}
          onClick={() => handleTabChange('generate')}
        >
          Generate Proof
        </button>
        <button
          className={`tab-button ${activeTab === 'verify' ? 'active' : ''}`}
          onClick={() => handleTabChange('verify')}
        >
          Verify Proof
        </button>
      </div>

      <div className={`tab-content ${isTransitioning ? 'fade-out' : ''}`}>
        {activeTab === 'generate' ? (
          <>
            <form onSubmit={handleSubmit} className="proof-form">
        <div className="form-group">
          <label htmlFor="settled_note_hash">Settled Note Hash:</label>
          <input
            type="text"
            id="settled_note_hash"
            name="settled_note_hash"
            value={formData.settled_note_hash}
            onChange={handleInputChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="contract_address">Contract Address:</label>
          <input
            type="text"
            id="contract_address"
            name="contract_address"
            value={formData.contract_address}
            onChange={handleInputChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="recipient">Recipient:</label>
          <input
            type="text"
            id="recipient"
            name="recipient"
            value={formData.recipient}
            onChange={handleInputChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="randomness">Randomness:</label>
          <input
            type="text"
            id="randomness"
            name="randomness"
            value={formData.randomness}
            onChange={handleInputChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="value">Value:</label>
          <input
            type="text"
            id="value"
            name="value"
            value={formData.value}
            onChange={handleInputChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="storage_slot">Storage Slot:</label>
          <input
            type="text"
            id="storage_slot"
            name="storage_slot"
            value={formData.storage_slot}
            onChange={handleInputChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="note_nonce">Note Nonce:</label>
          <input
            type="text"
            id="note_nonce"
            name="note_nonce"
            value={formData.note_nonce}
            onChange={handleInputChange}
            required
          />
        </div>

        <button type="submit" className="submit-button" disabled={isLoading}>
          {isLoading ? 'Generating Proof...' : 'Generate Proof'}
        </button>
      </form>

      {error && (
        <div className="error-message">
          <h3>Error</h3>
          <p>{error}</p>
        </div>
      )}

      {proofResult && (
        <div className="results-container">
          <h2>Proof Generation Results</h2>

          <div className="result-section">
            <h3>Verification Status</h3>
            <div className={`verification-status ${proofResult.verified ? 'verified' : 'failed'}`}>
              {proofResult.verified ? '✅ Proof Verified Successfully' : '❌ Proof Verification Failed'}
            </div>
          </div>

          <div className="result-section">
            <h3>Witness</h3>
            <div className="data-display">
              <div className="data-info">
                <span>Length: {proofResult.witness.length} bytes</span>
                <button
                  className="copy-button"
                  onClick={() => navigator.clipboard.writeText(Array.from(proofResult.witness).join(','))}
                >
                  Copy as Array
                </button>
              </div>
              <div className="hex-display">
                {Array.from(proofResult.witness.slice(0, 100)).map(byte =>
                  byte.toString(16).padStart(2, '0')
                ).join(' ')}
                {proofResult.witness.length > 100 && '...'}
              </div>
            </div>
          </div>

          <div className="result-section">
            <h3>Proof</h3>
            <div className="data-display">
              <div className="data-info">
                <span>Length: {proofResult.proof.length} bytes</span>
                <button
                  className="copy-button"
                  onClick={() => navigator.clipboard.writeText(Array.from(proofResult.proof).join(','))}
                >
                  Copy as Array
                </button>
              </div>
              <div className="hex-display">
                {Array.from(proofResult.proof.slice(0, 100)).map(byte =>
                  byte.toString(16).padStart(2, '0')
                ).join(' ')}
                {proofResult.proof.length > 100 && '...'}
              </div>
            </div>
          </div>

          <div className="result-section">
            <h3>Public Inputs</h3>
            <div className="data-display">
              <div className="data-info">
                <span>Count: {proofResult.publicInputs.length} inputs</span>
                <button
                  className="copy-button"
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(proofResult.publicInputs))}
                >
                  Copy as JSON
                </button>
              </div>
              <div className="data-display">
                <pre>{JSON.stringify(proofResult.publicInputs, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
          </>
        ) : (
          <>
            <form onSubmit={handleVerifySubmit} className="proof-form">
            <div className="form-group">
              <label htmlFor="proof">Proof (comma-separated bytes):</label>
              <textarea
                id="proof"
                name="proof"
                value={verifyData.proof}
                onChange={handleVerifyInputChange}
                placeholder="1,2,3,4,5..."
                rows={6}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="publicInputs">Public Inputs (JSON array):</label>
              <textarea
                id="publicInputs"
                name="publicInputs"
                value={verifyData.publicInputs}
                onChange={handleVerifyInputChange}
                placeholder='["0x123", "0x456"]'
                rows={4}
                required
              />
            </div>

            <button type="submit" className="verify-button" disabled={isVerifying}>
              {isVerifying ? 'Verifying...' : 'Verify Proof'}
            </button>
          </form>

          {verifyError && (
            <div className="error-message">
              <h3>Error</h3>
              <p>{verifyError}</p>
            </div>
          )}

          {verifyResult && (
            <div className="results-container">
              <h2>Verification Results</h2>
              <div className={`verification-status ${verifyResult.verified ? 'verified' : 'failed'}`}>
                {verifyResult.verified ? '✅ Proof Verified Successfully' : '❌ Proof Verification Failed'}
              </div>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  )
}

export default App
