import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize OpenAI client
if (!process.env.OPENAI_API_KEY) {
  console.warn('WARNING: OPENAI_API_KEY not set. Image analysis will fail.');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// In-memory cache for image descriptions
const cache = new Map();

// Helper to generate cache key from image URL or base64 + context
function getCacheKey(imageUrl, imageBase64, context, pageTitle) {
  const contextHash = crypto.createHash('sha256')
    .update((context || '') + (pageTitle || ''))
    .digest('hex')
    .substring(0, 8);
  
  if (imageBase64) {
    const hash = crypto.createHash('sha256').update(imageBase64).digest('hex');
    return `base64:${hash}:ctx:${contextHash}`;
  }
  return `url:${imageUrl}:ctx:${contextHash}`;
}

// Helper to convert regionHint string to coordinates
function parseRegionHint(hint) {
  const hints = {
    'top-left': { x: 10, y: 10, width: 30, height: 30 },
    'top-center': { x: 35, y: 10, width: 30, height: 30 },
    'top-right': { x: 60, y: 10, width: 30, height: 30 },
    'left': { x: 10, y: 35, width: 30, height: 30 },
    'center': { x: 35, y: 35, width: 30, height: 30 },
    'right': { x: 60, y: 35, width: 30, height: 30 },
    'bottom-left': { x: 10, y: 60, width: 30, height: 30 },
    'bottom-center': { x: 35, y: 60, width: 30, height: 30 },
    'bottom-right': { x: 60, y: 60, width: 30, height: 30 },
    'top': { x: 35, y: 5, width: 30, height: 25 },
    'bottom': { x: 35, y: 70, width: 30, height: 25 },
    'far': { x: 70, y: 5, width: 25, height: 40 },
    'left wall': { x: 5, y: 20, width: 25, height: 50 },
    'right wall': { x: 70, y: 20, width: 25, height: 50 },
    'far end': { x: 70, y: 5, width: 25, height: 40 },
    'ceiling': { x: 20, y: 0, width: 60, height: 15 },
    'floor': { x: 15, y: 70, width: 70, height: 30 },
    'foreground': { x: 10, y: 60, width: 80, height: 35 },
    'background': { x: 20, y: 10, width: 60, height: 50 }
  };
  
  if (hints[hint?.toLowerCase()]) {
    return hints[hint.toLowerCase()];
  }
  
  const lowerHint = hint?.toLowerCase() || '';
  for (const [key, value] of Object.entries(hints)) {
    if (lowerHint.includes(key)) {
      return value;
    }
  }
  
  return { x: 35, y: 35, width: 30, height: 30 };
}

// STAGE 1: PLANNER - Quick classification and lens recommendation
async function runPlanner(imageContent, context, pageTitle, hostDomain) {
  const plannerSystemPrompt = `You are an accessibility assistant for BLV users. Classify the image type and decide the best rotor lenses to organize the visual contents directory. Output ONLY valid JSON.`;

  const plannerUserPrompt = `Analyze this image and provide a planning JSON. Think of the rotor as a directory of visual contents - what visual elements are present in this image that should be cataloged?

Context:
- Page title: ${pageTitle || 'Not available'}
- Surrounding context: ${context || 'Not available'}
- Host domain: ${hostDomain || 'Not available'}

Identify VISUAL CONTENTS and organize into DIVERSE, DYNAMIC lenses (4-7 lenses).

STANDARD: Text, Objects, Layout, Data, People, Style
SPECIALIZED (by image type):
- Art: "Artwork Details", "Composition", "Technique", "Symbols"
- Architecture: "Architectural Features", "Structural Elements", "Materials"
- Nature/Landscape: "Natural Elements", "Terrain", "Weather", "Flora & Fauna"
- Food: "Food Items", "Presentation", "Ingredients"
- Portraits: "Facial Features", "Expression", "Pose", "Clothing"
- Events: "Activities", "Participants", "Setting"
- Fashion: "Garments", "Accessories", "Styling"
- Sports: "Action", "Equipment", "Players"
- Documents: "Sections", "Headings", "Content Blocks"
- Charts/Data: "Data Points", "Trends", "Labels", "Legend"
- Screenshots: "UI Elements", "Content", "Navigation"
- Products: "Product Features", "Packaging", "Branding"
- Maps: "Locations", "Routes", "Markers", "Regions"

Mix standard and specialized lenses. Be specific (e.g., "Foreground Objects" vs "Background Elements").

Classify imageType: "art", "architecture", "landscape", "portrait", "street", "nature", "food", "event", "interior", "fashion", "sports", "wildlife", "photo", "document", "chart", "screenshot", "meme", "product", "map"

Output JSON with these exact fields (example provided below):
{
  "imageType": "document" | "chart" | "screenshot" | "meme" | "product" | "map" | "art" | "architecture" | "landscape" | "portrait" | "street" | "nature" | "food" | "event" | "interior" | "fashion" | "sports" | "wildlife" | "photo" | "unknown",
  "taskHint": "skim" | "read_text" | "data" | "social" | "general",
  "hasText": true/false,
  "recommendedLenses": ["Text", "Layout", "Objects", ...],  // 4-7 lenses, mix standard and specialized, ordered by priority
  "lensSpecs": {
    "Text": {"mustInclude": ["title", "labels"], "maxItems": 6},
    "Layout": {"maxItems": 6},
    ...
  },
  "globalSalienceHeuristics": ["central visual elements first", "text elements before style if present", "prominent visual contents prioritized", ...]
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: plannerSystemPrompt
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: plannerUserPrompt },
          imageContent
        ]
      }
    ],
    max_tokens: 800,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  });

  return JSON.parse(response.choices[0].message.content);
}

// Generate alt-text using original prompt
async function generateAltText(imageContent, context, pageTitle) {
  const altTextPrompt = `Write the alt-text for this image. I will provide the guidelines to follow for writing good alt-text (GUIDELINES), the title of the page where the image appears (PAGE TITLE), and the surrounding text (CONTEXT), which may provide additional details about the image's subject.

GUIDELINES:
1) Keep it short and clear: 1-2 lines of plain text with no acronyms, abbreviations, or jargon 
2) Describe what can be seen: Don't add your own research, interpretation, or point of view 
3) Focus on what is relevant to the article: consider the text around it as context, but don't repeat the text 
4) Transcribe words and graphics: Write out any words in the image in quotation marks and summarize the main idea of maps, diagrams, and charts 
5) Type of image: Do not start with 'This is an image of...' but describe the medium or style, if relevant 
6) Take care with people: Only identify public figures and make sure any description is relevant, apparent, and verifiable.

${pageTitle ? `PAGE TITLE: ${pageTitle}` : ''}

${context ? `CONTEXT: ${context}` : ''}

Now provide the alt-text for this image.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: altTextPrompt },
          imageContent
        ]
      }
    ],
    max_tokens: 150,
    temperature: 0.2
  });

  return response.choices[0].message.content.trim();
}

// STAGE 2: GENERATOR - Full RotorResult generation
async function runGenerator(imageContent, plannerResult, context, pageTitle) {
  const generatorSystemPrompt = `You generate a visual contents directory for BLV users. Think of the rotor as a skimmable table of contents listing the actual visual elements present in the image. Each item represents a distinct visual element that can be found in the image. Output ONLY valid JSON that matches the schema exactly.`;

  const generatorUserPrompt = `Generate a complete RotorResult based on this planner output. 

IMPORTANT: Think of this rotor as a DIRECTORY OF VISUAL CONTENTS - like a table of contents for what's visually present in the image. Each lens organizes visual elements by type, and each item represents a specific visual element that exists in the image.

The imageType from the planner indicates the specific category (e.g., "art", "architecture", "landscape", "portrait", "street", "nature", "food", "event", "interior", "fashion", "sports", "wildlife", or generic "photo"). Use this to inform what visual elements are most relevant to catalog.

PLANNER OUTPUT:
${JSON.stringify(plannerResult, null, 2)}

CONTEXT:
- Page title: ${pageTitle || 'Not available'}
- Surrounding context: ${context || 'Not available'}

CRITICAL REQUIREMENTS - VISUAL CONTENTS DIRECTORY:

1. altText: Will be provided separately (do not generate in this call)

2. imageText: Array of transcribed visible text strings (exact text, no quotes in JSON)

3. lenses: Array of RotorLens objects matching recommendedLenses from planner. Each lens is a category of visual contents. Use the EXACT lens names from recommendedLenses - they may be specialized (e.g., "Artwork Details", "Food Items", "Architectural Features") or standard (e.g., "Text", "Objects", "Layout"). The lens id should be a lowercase, hyphenated version of the label (e.g., "Artwork Details" -> id: "artwork-details", "Food Items" -> id: "food-items").

4. Each RotorItem represents ONE DISTINCT VISUAL ELEMENT in the image:
   - id: stable id based on the visual element (e.g., "text-title-1", "object-person-center", "chart-sales-data")
   - label: The visual element's name/title - MUST include actual content for skimmability:
     * For text elements: Include the actual text! Format: "Text: '[actual text content]'" or "'[actual text]' (title)" - e.g., "Text: 'Welcome to Gallery'", "'Sales Report' (heading)", "'Click here' (button label)"
     * For objects: Specific name with key attribute - e.g., "Red sedan car", "Woman in blue shirt", "Bar chart"
     * For layout regions: "Left column", "Top header", "Center panel"
     * For data: "Sales chart", "Pie chart: Q1", "Line graph"
   - focusSummary: <= 8 words, quick preview with ACTUAL CONTENT when relevant:
     * For text: Include the actual text! Format: "'[text]' at [location]" - e.g., "'Welcome' at top", "'Click here' button"
     * For objects: "[Element] at [location]" - e.g., "Red car in foreground", "Chart showing sales"
     * For data: Include key numbers/values if relevant - e.g., "Sales up 20%", "Q1: $50k"
   - description: 2-4 sentences providing a slightly more detailed explanation of THIS SPECIFIC VISUAL ELEMENT. Focus on essential facts:
     * What this visual element is and what it contains/shows (for text: include the full text; for charts: key data points)
     * Where it appears (location, position)
     * Key visual characteristics (size, color, style - only most important)
     * Example for a text element: "The text 'Welcome to Our Gallery' appears at the top center in large bold black letters. It uses a modern sans-serif font and is centered on a white background."
     * Example for an object: "A bright red sedan car is positioned in the center foreground. The car has four doors and chrome trim, appearing to be a modern compact design from around 2020."
     * Example for a chart: "A bar chart shows sales data with Q1 at $50k, Q2 at $65k, and Q3 at $72k. The chart uses blue bars and is positioned in the center of the image."
   - regionHint: "top-left" | "left" | "center" | "bottom" | "far" | etc (where this visual element is located)
   - confidence: "high" | "medium" | "low"
   - evidence: "visual" | "text" (optional)
   - salience: 1-5 (5 = most important visual element for understanding the image)
   - subItems: OPTIONAL array of RotorItem objects for drill-down navigation. Include sub-items when the visual element has multiple distinct aspects that can be explored:
     * For people: ["Facial features", "Clothing", "Pose", "Expression", "Accessories"]
     * For objects: ["Shape", "Color", "Size", "Position", "Material"]
     * For text: ["Font style", "Size", "Color", "Position", "Content"]
     * For charts: ["Data points", "Axes", "Legend", "Trends"]
     * For architecture: ["Structural elements", "Materials", "Style", "Details"]
     * Each sub-item should have: id, label, focusSummary, description, confidence, salience
     * Limit: 3-6 sub-items per item (only include if the element has multiple explorable aspects)

5. DIRECTORY STRUCTURE PRINCIPLES:
   - Each item = one distinct visual element that can be found in the image
   - Items should be organized like a table of contents - skimmable, scannable
   - Labels should be clear, specific names of visual elements (not abstract descriptions)
   - focusSummary = quick preview of what visual element this is
   - description = full catalog entry describing this visual element in detail
   - Think: "What visual things are in this image?" not "What does this image mean?"
   - Organize by visual element type (text, objects, layout regions, data visualizations, etc.)

6. Limit: 4-7 items max per lens (use lensSpecs.maxItems from planner). More specialized lenses may have fewer items, standard lenses may have more.

7. If uncertain about a visual element, set confidence to "low" and be honest about uncertainty

8. Text lens items MUST:
   - Have evidence: "text"
   - Include the ACTUAL TRANSCRIBED TEXT in the label (format: "Text: '[text]'" or "'[text]' (type)")
   - Include the ACTUAL TEXT in focusSummary (format: "'[text]' at [location]")
   - Include the FULL TEXT in description (don't just say "title text" - include what it says)
   - Match text from the imageText array when possible

Output JSON (NOTE: altText will be provided separately, do not include it):
{
  "imageText": ["...", "..."],
  "imageType": "...",
  "taskHint": "...",
  "lenses": [
    {
      "id": "text",
      "label": "Text",
      "items": [
        {
          "id": "text-title-1",
          "label": "Text: 'Welcome to Our Gallery'",
          "focusSummary": "'Welcome to Gallery' at top center",
          "description": "The text 'Welcome to Our Gallery' appears at the top center of the image in large bold black letters, approximately 48 points in size. It uses a modern sans-serif font and is centered horizontally on a white background. The title is positioned about 10% from the top edge of the image and serves as the main heading. Below this title, a smaller gray subtitle is visible.",
          "regionHint": "top-center",
          "confidence": "high",
          "evidence": "text",
          "salience": 5,
          "subItems": [
            {
              "id": "text-title-1-font",
              "label": "Font style",
              "focusSummary": "Modern sans-serif font",
              "description": "The text uses a modern sans-serif font, likely Arial or Helvetica, in a bold weight. The font size is approximately 48 points, making it highly visible and prominent.",
              "confidence": "high",
              "salience": 3
            },
            {
              "id": "text-title-1-position",
              "label": "Position",
              "focusSummary": "Top center placement",
              "description": "The title is positioned at the top center of the image, approximately 10% from the top edge. It is horizontally centered and serves as the main visual anchor point.",
              "confidence": "high",
              "salience": 4
            }
          ]
        },
        ...
      ]
    },
    ...
  ]
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: generatorSystemPrompt
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: generatorUserPrompt },
          imageContent
        ]
      }
    ],
    max_tokens: 3000,
    temperature: 0.2,
    response_format: { type: 'json_object' }
  });

  let result = JSON.parse(response.choices[0].message.content);

  // TEXT-FIRST AUTO-PRIORITIZATION
  // If hasText is true OR imageText has items, ensure Text lens is first
  if (plannerResult.hasText || (result.imageText && result.imageText.length > 0)) {
    // Find Text lens
    const textLensIndex = result.lenses.findIndex(l => 
      l.id === 'text' || l.label.toLowerCase() === 'text'
    );
    
    if (textLensIndex > 0) {
      // Move Text lens to first position
      const textLens = result.lenses.splice(textLensIndex, 1)[0];
      result.lenses.unshift(textLens);
    } else if (textLensIndex === -1 && plannerResult.hasText) {
      // Create Text lens if missing but planner says text exists
      result.lenses.unshift({
        id: 'text',
        label: 'Text',
        items: result.imageText.map((text, i) => ({
          id: `text-${i}`,
          label: `Text: '${text.substring(0, 30)}'`,
          focusSummary: `Text: ${text.substring(0, 20)}`,
          description: `The text "${text}" appears in the image. It is clearly visible and readable.`,
          regionHint: 'center',
          confidence: 'high',
          evidence: 'text',
          salience: 5
        }))
      });
    }
  }

  // Convert regionHint strings to coordinate objects for items
  for (const lens of result.lenses) {
    for (const item of lens.items) {
      if (item.regionHint && typeof item.regionHint === 'string') {
        item.regionHintCoords = parseRegionHint(item.regionHint);
      }
    }
  }

  return result;
}

// API route to describe image (2-stage pipeline)
app.post('/api/describe-image', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured',
        message: 'Please set the OPENAI_API_KEY environment variable'
      });
    }

    const { imageUrl, imageBase64, context, pageTitle } = req.body;

    if (!imageUrl && !imageBase64) {
      return res.status(400).json({ error: 'Either imageUrl or imageBase64 is required' });
    }

    // Extract host domain from imageUrl if available
    let hostDomain = null;
    try {
      if (imageUrl) {
        const url = new URL(imageUrl);
        hostDomain = url.hostname;
      }
    } catch (e) {
      // Ignore
    }

    // Check cache
    const cacheKey = getCacheKey(imageUrl, imageBase64, context, pageTitle);
    if (cache.has(cacheKey)) {
      console.log('Cache hit for:', cacheKey.substring(0, 50));
      return res.json(cache.get(cacheKey));
    }

    // Prepare image for OpenAI
    // Create two versions: one with low detail for planner (faster), one with high detail for generator
    let imageContentBase;
    if (imageBase64) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      imageContentBase = {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${base64Data}`
        }
      };
    } else if (imageUrl) {
      // Try to fetch the image server-side and convert to base64
      // This bypasses CORS restrictions since the server can fetch from any origin
      try {
        console.log('[Server] Fetching image from URL to convert to base64:', imageUrl.substring(0, 100));
        
        // Use native fetch (available in Node.js 18+)
        const imageResponse = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ImageRotor/1.0)',
            'Accept': 'image/*'
          }
        });
        
        if (!imageResponse.ok) {
          throw new Error(`Failed to fetch image: HTTP ${imageResponse.status} ${imageResponse.statusText}`);
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageBase64FromServer = Buffer.from(imageBuffer).toString('base64');
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        
        // Limit image size to avoid OpenAI API limits (max ~20MB for base64)
        if (imageBase64FromServer.length > 20 * 1024 * 1024) {
          throw new Error('Image too large (exceeds 20MB limit)');
        }
        
        console.log('[Server] Successfully converted image URL to base64, size:', Math.round(imageBase64FromServer.length / 1024), 'KB');
        imageContentBase = {
          type: 'image_url',
          image_url: {
            url: `data:${contentType};base64,${imageBase64FromServer}`
          }
        };
      } catch (fetchError) {
        console.warn('[Server] Failed to fetch image server-side, using URL directly:', fetchError.message);
        console.warn('[Server] OpenAI will attempt to fetch the image URL directly');
        // Fallback to using URL directly - OpenAI might be able to access it
        imageContentBase = {
          type: 'image_url',
          image_url: {
            url: imageUrl
          }
        };
      }
    } else {
      throw new Error('No image URL or base64 data provided');
    }

    // Create low-detail version for planner (faster processing)
    const imageContentLowDetail = {
      ...imageContentBase,
      image_url: {
        ...imageContentBase.image_url,
        detail: 'low'
      }
    };

    // Run alt-text and planner in parallel (planner uses low detail for speed)
    console.log('[Server] Running alt-text generation and planner in parallel...');
    const [altText, plannerResult] = await Promise.all([
      generateAltText(imageContentBase, context, pageTitle),
      runPlanner(imageContentLowDetail, context, pageTitle, hostDomain)
    ]);
    console.log('[Server] Alt-text generated:', altText);
    console.log('[Server] Planner result:', plannerResult);

    // STAGE 2: Generator (depends on plannerResult, uses high detail)
    console.log('[Server] Running generator...');
    const result = await runGenerator(imageContentBase, plannerResult, context, pageTitle);
    console.log('[Server] Generator complete');
    
    // Replace altText with the one generated using original prompt
    result.altText = altText;

    // Cache the result
    cache.set(cacheKey, result);

    res.json(result);
  } catch (error) {
    console.error('Error describing image:', error);
    console.error('Error stack:', error.stack);
    
    // Provide more specific error messages
    let errorMessage = error.message || 'Unknown error';
    let errorType = 'Unknown';
    
    if (error.message?.includes('API key')) {
      errorType = 'Configuration';
      errorMessage = 'OpenAI API key is not configured or invalid';
    } else if (error.message?.includes('fetch') || error.message?.includes('network')) {
      errorType = 'Network';
      errorMessage = 'Network error while accessing image or OpenAI API';
    } else if (error.message?.includes('JSON') || error.message?.includes('parse')) {
      errorType = 'Parsing';
      errorMessage = 'Failed to parse response from OpenAI';
    } else if (error.message?.includes('rate limit') || error.message?.includes('429')) {
      errorType = 'RateLimit';
      errorMessage = 'OpenAI API rate limit exceeded. Please try again later.';
    } else if (error.message?.includes('image') || error.message?.includes('URL')) {
      errorType = 'ImageAccess';
      errorMessage = `Cannot access image at URL. The image may require authentication or be blocked. Original error: ${error.message}`;
    }
    
    res.status(500).json({ 
      error: 'Failed to describe image',
      errorType: errorType,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Image Rotor API server running on port ${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY environment variable is not set!');
    console.error('Set it with: export OPENAI_API_KEY=your_key_here');
  } else {
    console.log('OpenAI API key: Set');
  }
});
