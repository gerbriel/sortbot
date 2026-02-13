import { useState } from 'react';
import { Brain } from 'lucide-react';
import { analyzeLlamaVision } from '../lib/huggingfaceService';
import type { LlamaVisionAnalysis } from '../lib/huggingfaceService';
import './TestLlamaVision.css';

export default function TestLlamaVision() {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<LlamaVisionAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const analysis = await analyzeLlamaVision(file);
      setResult(analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze image');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="test-llama-container">
      <div className="test-llama-card">
        <h3>
          <Brain size={24} />
          Test Llama 3.2 Vision
        </h3>
        <p className="test-description">
          Upload a clothing image to test AI analysis
        </p>

        <input
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          disabled={analyzing}
          className="file-input"
          id="test-file-input"
        />
        <label htmlFor="test-file-input" className="file-label">
          {analyzing ? '🔄 Analyzing...' : '📸 Choose Image to Test'}
        </label>

        {analyzing && (
          <div className="analyzing-spinner">
            <div className="spinner"></div>
            <p>Analyzing with Llama 3.2 Vision...</p>
            <p className="sub-text">First request may take 20-30 seconds (model warming up)</p>
          </div>
        )}

        {error && (
          <div className="test-result error">
            <h4>❌ Error</h4>
            <p>{error}</p>
          </div>
        )}

        {result && (
          <div className="test-result success">
            <h4>✅ Analysis Complete!</h4>
            <div className="result-grid">
              <div className="result-item">
                <strong>Product Type:</strong>
                <span>{result.productType}</span>
              </div>
              {result.brand && (
                <div className="result-item">
                  <strong>Brand:</strong>
                  <span>{result.brand}</span>
                </div>
              )}
              <div className="result-item">
                <strong>Color:</strong>
                <span>{result.color}</span>
              </div>
              <div className="result-item">
                <strong>Material:</strong>
                <span>{result.material}</span>
              </div>
              <div className="result-item">
                <strong>Condition:</strong>
                <span>{result.condition}</span>
              </div>
              {result.era && (
                <div className="result-item">
                  <strong>Era:</strong>
                  <span>{result.era}</span>
                </div>
              )}
              {result.style && (
                <div className="result-item">
                  <strong>Style:</strong>
                  <span>{result.style}</span>
                </div>
              )}
              <div className="result-item full-width">
                <strong>Description:</strong>
                <p>{result.description}</p>
              </div>
              <div className="result-item">
                <strong>Confidence:</strong>
                <span>{(result.confidence * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
