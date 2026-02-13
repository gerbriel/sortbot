// ============================================================================
// HUGGING FACE PROXY SERVER
// ============================================================================
// Simple Express proxy to bypass CORS restrictions for Hugging Face API
// Run: node huggingface-proxy.js
// ============================================================================

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Enable CORS for your React app
app.use(cors({
  origin: 'http://localhost:5173'
}));

// Parse JSON bodies
app.use(express.json({ limit: '50mb' }));

// Proxy endpoint for Llama Vision
app.post('/api/llama-vision', async (req, res) => {
  const API_KEY = process.env.VITE_HUGGINGFACE_API_KEY;
  
  if (!API_KEY) {
    return res.status(500).json({ error: 'Hugging Face API key not configured' });
  }

  try {
    const fetch = (await import('node-fetch')).default;
    
    // Use Llama 3.1 8B Instruct (TEXT ONLY - not vision, this works!)
    const response = await fetch(
      'https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3.1-8B-Instruct',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req.body)
      }
    );

    // Try to parse as JSON, fallback to text
    let data;
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error('Non-JSON response:', response.status, text);
      data = { error: text };
    }
    
    if (!response.ok) {
      console.error('HuggingFace API error:', response.status, data);
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Proxy request failed', details: error.message });
  }
});

// Proxy endpoint for Llama Text
app.post('/api/llama-text', async (req, res) => {
  const API_KEY = process.env.VITE_HUGGINGFACE_API_KEY;
  
  if (!API_KEY) {
    return res.status(500).json({ error: 'Hugging Face API key not configured' });
  }

  try {
    const fetch = (await import('node-fetch')).default;
    
    // Use FREE Inference API (not router!) with Mistral 7B Instruct (faster and reliable)
    const response = await fetch(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req.body)
      }
    );

    // Try to parse as JSON, fallback to text
    let data;
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error('Non-JSON response:', response.status, text);
      data = { error: text };
    }
    
    if (!response.ok) {
      console.error('HuggingFace API error:', response.status, data);
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Proxy request failed', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🦙 Hugging Face Proxy running on http://localhost:${PORT}`);
  console.log(`✅ CORS enabled for http://localhost:5173`);
  console.log(`🔑 API Key: ${process.env.VITE_HUGGINGFACE_API_KEY ? 'Loaded' : 'Missing'}`);
});
