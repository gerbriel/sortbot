import { useState, useEffect } from 'react';
import { Settings, Sparkles, Brain } from 'lucide-react';
import './AISettings.css';

export type AIProvider = 'google-vision' | 'llama-vision';

interface AISettingsProps {
  onProviderChange?: (provider: AIProvider) => void;
}

export default function AISettings({ onProviderChange }: AISettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [provider, setProvider] = useState<AIProvider>(() => {
    // Hugging Face text AI is back and working!
    const saved = localStorage.getItem('ai_provider') as AIProvider;
    return saved || 'llama-vision';
  });

  const hasGoogleKey = !!import.meta.env.VITE_GOOGLE_VISION_API_KEY;

  useEffect(() => {
    localStorage.setItem('ai_provider', provider);
    onProviderChange?.(provider);
  }, [provider, onProviderChange]);

  const handleProviderChange = (newProvider: AIProvider) => {
    setProvider(newProvider);
    setIsOpen(false);
  };

  return (
    <div className="ai-settings">
      <button 
        className="ai-settings-button"
        onClick={() => setIsOpen(!isOpen)}
        title="AI Provider Settings"
      >
        <Settings size={20} />
        <span>AI: {provider === 'google-vision' ? 'Google' : 'Llama 3'}</span>
      </button>

      {isOpen && (
        <div className="ai-settings-modal">
          <div className="ai-settings-content">
            <h3>
              <Sparkles size={20} />
              AI Vision Provider
            </h3>
            
            <div className="ai-provider-options">
              <button
                className={`ai-provider-option ${provider === 'google-vision' ? 'active' : ''}`}
                onClick={() => handleProviderChange('google-vision')}
                disabled={!hasGoogleKey}
              >
                <div className="provider-icon">🔍</div>
                <div className="provider-details">
                  <strong>Google Vision</strong>
                  <span className="provider-description">
                    Fast, accurate label detection
                  </span>
                  {!hasGoogleKey && (
                    <span className="provider-status error">
                      ⚠️ API key required
                    </span>
                  )}
                </div>
              </button>

              <button
                className={`ai-provider-option ${provider === 'llama-vision' ? 'active' : ''}`}
                onClick={() => handleProviderChange('llama-vision')}
              >
                <div className="provider-icon">
                  <Brain size={24} />
                </div>
                <div className="provider-details">
                  <strong>Hugging Face Text AI (Llama 3.1)</strong>
                  <span className="provider-description">
                    FREE! Smart template system (Hugging Face API deprecated)
                  </span>
                  <span className="provider-status success">
                    ✅ Works offline - No API needed!
                  </span>
                </div>
              </button>
            </div>

            <div className="ai-settings-footer">
              <p>
                <strong>How to get API keys:</strong>
              </p>
              <ul>
                <li>
                  <strong>Hugging Face:</strong>{' '}
                  <a 
                    href="https://huggingface.co/settings/tokens" 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    Get FREE token →
                  </a>
                </li>
                <li>
                  <strong>Google Vision:</strong>{' '}
                  <a 
                    href="https://console.cloud.google.com/apis/credentials" 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    Get API key →
                  </a>
                </li>
              </ul>
              <p className="help-text">
                Add keys to your <code>.env</code> file and restart the dev server.
              </p>
            </div>

            <button 
              className="close-button"
              onClick={() => setIsOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
