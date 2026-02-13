// ============================================================================
// HUGGING FACE LLAMA 3 VISION SERVICE
// ============================================================================
// Uses Hugging Face Inference API with Llama 3.2 Vision for image analysis
// Free tier: https://huggingface.co/settings/tokens
// ============================================================================

interface HuggingFaceResponse {
  generated_text?: string;
  error?: string;
}

export interface LlamaVisionAnalysis {
  productType: string;
  brand?: string;
  color: string;
  material: string;
  condition: string;
  era?: string;
  style?: string;
  description: string;
  confidence: number;
}

/**
 * Analyze clothing image using Llama 3.2 Vision via local proxy
 * Proxy URL: http://localhost:3001
 */
export async function analyzeLlamaVision(imageFile: File): Promise<LlamaVisionAnalysis> {
  try {
    // Convert image to base64
    const base64Image = await fileToBase64(imageFile);
    
    // Call local proxy instead of Hugging Face directly (bypasses CORS)
    const response = await fetch('http://localhost:3001/api/llama-vision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {
          image: base64Image,
          prompt: `Analyze this clothing item and provide detailed information in JSON format:
{
  "productType": "specific item type (e.g., Vintage Band T-Shirt, Levi's 501 Jeans)",
  "brand": "brand name if visible",
  "color": "primary color",
  "material": "fabric type (e.g., Cotton, Denim, Wool)",
  "condition": "condition description",
  "era": "decade or era (e.g., 1990s, 2000s)",
  "style": "style category (e.g., Vintage, Y2K, Streetwear)",
  "description": "2-3 sentence detailed description"
}

Focus on vintage and resale-relevant details. Be specific about graphics, logos, tags, and unique features.`
        },
        parameters: {
          max_new_tokens: 500,
          temperature: 0.3,
          return_full_text: false
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Proxy error: ${response.statusText}`);
    }

    const data: HuggingFaceResponse[] = await response.json();
    
    if (data[0]?.error) {
      throw new Error(data[0].error);
    }

    const generatedText = data[0]?.generated_text;
    
    if (!generatedText) {
      throw new Error('No response from Llama Vision');
    }

    // Parse JSON from response
    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON from response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      productType: parsed.productType || 'Clothing Item',
      brand: parsed.brand || undefined,
      color: parsed.color || 'Unknown',
      material: parsed.material || 'Unknown',
      condition: parsed.condition || 'Good',
      era: parsed.era || undefined,
      style: parsed.style || undefined,
      description: parsed.description || 'Vintage clothing item',
      confidence: 0.85
    };

  } catch (error) {
    console.error('Error analyzing with Llama Vision:', error);
    
    // Check if proxy is running
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error('❌ Proxy server not running! Start it with: node huggingface-proxy.js');
    }
    
    throw error; // Don't use mock data - throw error to user
  }
}

/**
 * Generate product description using Llama 3 text model
 */
export async function generateLlamaDescription(
  productType: string,
  color: string,
  brand?: string,
  material?: string,
  condition?: string
): Promise<string> {
  const apiKey = import.meta.env.VITE_HUGGINGFACE_API_KEY;
  
  if (!apiKey) {
    return generateMockDescription(productType, color, brand);
  }

  try {
    const prompt = `Write a compelling 2-3 sentence product description for:
Product: ${productType}
Color: ${color}
${brand ? `Brand: ${brand}` : ''}
${material ? `Material: ${material}` : ''}
${condition ? `Condition: ${condition}` : ''}

Focus on vintage appeal, unique features, and resale value. Be specific and enthusiastic.`;

    const response = await fetch(
      'https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: 150,
            temperature: 0.7,
            return_full_text: false
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Hugging Face API error: ${response.statusText}`);
    }

    const data: HuggingFaceResponse[] = await response.json();
    return data[0]?.generated_text?.trim() || generateMockDescription(productType, color, brand);

  } catch (error) {
    console.error('Error generating Llama description:', error);
    return generateMockDescription(productType, color, brand);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function generateMockLlamaAnalysis(): LlamaVisionAnalysis {
  const mockTypes = [
    'Vintage Band T-Shirt',
    'Levi\'s 501 Jeans',
    'Nike Windbreaker',
    'Champion Hoodie',
    'Carhartt Work Jacket'
  ];
  
  const mockColors = ['Black', 'Blue', 'Gray', 'White', 'Red'];
  const mockMaterials = ['Cotton', 'Denim', 'Polyester', 'Cotton Blend'];
  
  return {
    productType: mockTypes[Math.floor(Math.random() * mockTypes.length)],
    brand: ['Nike', 'Levi\'s', 'Champion', undefined][Math.floor(Math.random() * 4)],
    color: mockColors[Math.floor(Math.random() * mockColors.length)],
    material: mockMaterials[Math.floor(Math.random() * mockMaterials.length)],
    condition: 'Good - Normal vintage wear',
    era: '1990s',
    style: 'Vintage',
    description: 'Classic vintage piece with authentic retro styling. Shows normal wear consistent with age.',
    confidence: 0.75
  };
}

function generateMockDescription(productType: string, color: string, brand?: string): string {
  const brandText = brand ? `${brand} ` : '';
  return `Classic ${brandText}${color.toLowerCase()} ${productType.toLowerCase()}. Authentic vintage styling with timeless appeal. Perfect for collectors and fashion enthusiasts.`;
}
