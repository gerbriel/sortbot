// API Service utilities for the AI Sorting App
// This file contains helper functions for integrating with external APIs

// ============================================
// OpenAI API Integration
// ============================================

export interface ProductDetails {
  title: string;
  description: string;
  price: number;
  tags: string[];
}

export async function generateProductDetails(
  voiceDescription: string,
  category: string
): Promise<ProductDetails> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  
  if (!apiKey) {
    console.warn('OpenAI API key not configured, using mock data');
    return generateMockProductDetails(voiceDescription, category);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{
          role: 'system',
          content: 'You are a professional e-commerce product listing writer. Generate compelling, SEO-friendly product information.'
        }, {
          role: 'user',
          content: `Create a product listing for this ${category} item: "${voiceDescription}". 
          
          Respond in JSON format with:
          - title: SEO-friendly product title (50-60 chars)
          - description: Compelling product description (2-3 sentences)
          - price: Suggested retail price in USD
          - tags: Array of 5 relevant tags for e-commerce`
        }],
        temperature: 0.7,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    
    return {
      title: content.title,
      description: content.description,
      price: content.price,
      tags: content.tags
    };
  } catch (error) {
    console.error('Error generating product details:', error);
    return generateMockProductDetails(voiceDescription, category);
  }
}

function generateMockProductDetails(description: string, category: string): ProductDetails {
  return {
    title: `Premium ${category} - ${description.split(',')[0]}`,
    description: `${description}. Perfect for any occasion, this ${category.toLowerCase()} combines style and comfort. Made with high-quality materials for lasting wear.`,
    price: Math.floor(Math.random() * 50) + 20,
    tags: [category, 'fashion', 'apparel', 'clothing', 'retail']
  };
}

// ============================================
// Google Vision API Integration (Optional)
// ============================================

export interface VisionLabels {
  category: string;
  color?: string;
  style?: string;
  confidence: number;
}

export async function analyzeClothingImage(imageFile: File): Promise<VisionLabels> {
  const apiKey = import.meta.env.VITE_GOOGLE_VISION_API_KEY;
  
  if (!apiKey) {
    console.warn('Google Vision API key not configured, using mock analysis');
    return generateMockVisionLabels();
  }

  try {
    // Convert image to base64
    const base64Image = await fileToBase64(imageFile);
    
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: base64Image.split(',')[1] },
            features: [
              { type: 'LABEL_DETECTION', maxResults: 10 },
              { type: 'IMAGE_PROPERTIES', maxResults: 5 }
            ]
          }]
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Vision API error: ${response.statusText}`);
    }

    const data = await response.json();
    const labels = data.responses[0].labelAnnotations;
    
    // Map labels to clothing categories
    const category = mapLabelsToCategory(labels);
    const colors = data.responses[0].imagePropertiesAnnotation?.dominantColors?.colors;
    
    return {
      category,
      color: colors?.[0]?.color ? rgbToColorName(colors[0].color) : undefined,
      confidence: labels[0]?.score || 0.8
    };
  } catch (error) {
    console.error('Error analyzing image:', error);
    return generateMockVisionLabels();
  }
}

function mapLabelsToCategory(labels: any[]): string {
  const categoryMap: Record<string, string> = {
    'clothing': 'Tops',
    'shirt': 'Tops',
    'blouse': 'Tops',
    't-shirt': 'Tops',
    'pants': 'Bottoms',
    'jeans': 'Bottoms',
    'trousers': 'Bottoms',
    'dress': 'Dresses',
    'coat': 'Outerwear',
    'jacket': 'Outerwear',
    'shoe': 'Shoes',
    'footwear': 'Shoes',
    'accessory': 'Accessories'
  };

  for (const label of labels) {
    const description = label.description.toLowerCase();
    if (categoryMap[description]) {
      return categoryMap[description];
    }
  }

  return 'Other';
}

function generateMockVisionLabels(): VisionLabels {
  const categories = ['Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes'];
  return {
    category: categories[Math.floor(Math.random() * categories.length)],
    confidence: 0.85
  };
}

// ============================================
// Google Sheets API Integration
// ============================================

export interface SheetData {
  title: string;
  handle: string;
  category: string;
  description: string;
  price: number;
  tags: string;
  imageUrl: string;
  status: string;
}

let gapiInitialized = false;

export async function initGoogleAPI(): Promise<void> {
  if (gapiInitialized) return;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => {
      (window as any).gapi.load('client:auth2', async () => {
        try {
          await (window as any).gapi.client.init({
            apiKey: import.meta.env.VITE_GOOGLE_API_KEY,
            clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
            discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
            scope: 'https://www.googleapis.com/auth/spreadsheets'
          });
          gapiInitialized = true;
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    };
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

export async function exportToGoogleSheets(data: SheetData[]): Promise<string> {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  
  if (!apiKey || !clientId) {
    console.warn('Google API credentials not configured');
    throw new Error('Google API credentials not configured. Please check your .env file.');
  }

  try {
    await initGoogleAPI();
    
    // Sign in user
    const authInstance = (window as any).gapi.auth2.getAuthInstance();
    if (!authInstance.isSignedIn.get()) {
      await authInstance.signIn();
    }

    // Create new spreadsheet
    const createResponse = await (window as any).gapi.client.sheets.spreadsheets.create({
      properties: {
        title: `Clothing Products - ${new Date().toLocaleDateString()}`
      }
    });

    const spreadsheetId = createResponse.result.spreadsheetId;

    // Prepare data
    const values = [
      ['Title', 'Handle', 'Category', 'Description', 'Price', 'Tags', 'Image URL', 'Status'],
      ...data.map(item => [
        item.title,
        item.handle,
        item.category,
        item.description,
        item.price,
        item.tags,
        item.imageUrl,
        item.status
      ])
    ];

    // Write data to sheet
    await (window as any).gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'RAW',
      resource: { values }
    });

    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  } catch (error) {
    console.error('Error exporting to Google Sheets:', error);
    throw error;
  }
}

// ============================================
// Utility Functions
// ============================================

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function rgbToColorName(rgb: { red: number; green: number; blue: number }): string {
  // Simplified color mapping
  const { red, green, blue } = rgb;
  
  if (red > 200 && green > 200 && blue > 200) return 'white';
  if (red < 50 && green < 50 && blue < 50) return 'black';
  if (red > green && red > blue) return 'red';
  if (green > red && green > blue) return 'green';
  if (blue > red && blue > green) return 'blue';
  if (red > 150 && green > 150) return 'yellow';
  
  return 'multicolor';
}

// ============================================
// Speech Recognition Integration
// ============================================

export function initSpeechRecognition(
  onResult: (transcript: string) => void,
  onError: (error: string) => void
): any | null {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn('Speech recognition not supported in this browser');
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onresult = (event: any) => {
    const transcript = event.results[0][0].transcript;
    onResult(transcript);
  };

  recognition.onerror = (event: any) => {
    onError(event.error);
  };

  return recognition;
}
