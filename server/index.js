import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import crypto from 'crypto';
import sharp from 'sharp';

const app = express();
const PORT = process.env.PORT || 3001;
const MODEL = 'gpt-4o-mini';

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

// In-memory cache for completed RotorResults
const cache = new Map();

// Fixed lens set the planner chooses from
const LENSES = {
  text: { label: 'Text', description: 'Only if text is prominent (documents, charts, screenshots, memes, signs)' },
  objects: { label: 'Objects', description: 'Physical objects, items, things (not people)' },
  people: { label: 'People', description: 'People, faces, human figures' },
  layout: { label: 'Layout', description: 'Spatial organization, composition, regions, sections' },
  background: { label: 'Background', description: 'Scene setting, environment, surroundings' },
  colors: { label: 'Colors', description: 'Dominant colors, color schemes, palette' },
  style: { label: 'Style', description: 'Visual style, artistic technique, aesthetic' },
  data: { label: 'Data', description: 'Charts, graphs, data visualization elements (only for data images)' }
};

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

// Convert regionHint strings to coordinate objects for items and their subItems
function addRegionCoords(items) {
  for (const item of items) {
    if (item.regionHint && typeof item.regionHint === 'string') {
      item.regionHintCoords = parseRegionHint(item.regionHint);
    }
    if (Array.isArray(item.subItems)) {
      addRegionCoords(item.subItems);
    }
  }
}

// Shrink the image to what OpenAI actually looks at. High detail fits the image in
// 2048x2048 and then scales the short side down to 768px, so anything larger is just
// upload time -- and the image is sent once per parallel call.
async function shrinkImage(buffer, contentType) {
  try {
    const meta = await sharp(buffer).metadata();
    let { width, height } = meta;
    if (meta.orientation >= 5) [width, height] = [height, width];
    const scale = Math.min(1, 2048 / Math.max(width, height), 768 / Math.min(width, height));
    const output = await sharp(buffer)
      .rotate()
      .resize(Math.round(width * scale), Math.round(height * scale))
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { data: output.toString('base64'), contentType: 'image/jpeg' };
  } catch (error) {
    console.warn('[Server] Could not resize image, sending original:', error.message);
    return { data: buffer.toString('base64'), contentType };
  }
}

// Build the OpenAI image content part from the client's base64 or URL
async function prepareImageContent(imageUrl, imageBase64) {
  if (imageBase64) {
    const match = imageBase64.match(/^data:(image\/[\w+.-]+);base64,/);
    const buffer = Buffer.from(imageBase64.replace(/^data:image\/[\w+.-]+;base64,/, ''), 'base64');
    const { data, contentType } = await shrinkImage(buffer, match?.[1] || 'image/jpeg');
    return { type: 'image_url', image_url: { url: `data:${contentType};base64,${data}` } };
  }

  // Fetch the image server-side, which bypasses browser CORS restrictions
  try {
    console.log('[Server] Fetching image from URL:', imageUrl.substring(0, 100));
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ImageRotor/1.0)',
        'Accept': 'image/*'
      }
    });

    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: HTTP ${imageResponse.status} ${imageResponse.statusText}`);
    }

    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    if (buffer.length > 20 * 1024 * 1024) {
      throw new Error('Image too large (exceeds 20MB limit)');
    }

    const { data, contentType } = await shrinkImage(buffer, imageResponse.headers.get('content-type') || 'image/jpeg');
    console.log('[Server] Prepared image, size:', Math.round(data.length / 1024), 'KB');
    return { type: 'image_url', image_url: { url: `data:${contentType};base64,${data}` } };
  } catch (fetchError) {
    console.warn('[Server] Failed to fetch image server-side, using URL directly:', fetchError.message);
    // Fallback to using URL directly - OpenAI might be able to access it
    return { type: 'image_url', image_url: { url: imageUrl } };
  }
}

// Generate alt-text using original prompt
async function generateAltText(imageContent, context, pageTitle, signal) {
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
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: altTextPrompt },
          imageContent
        ]
      }
    ],
    max_tokens: 100,  // Alt-text is short
    temperature: 0.2
  }, { signal });

  return response.choices[0].message.content.trim();
}

const generatorSystemPrompt = `You generate a visual contents directory for BLV users. Think of the rotor as a skimmable table of contents listing the actual visual elements present in the image. Each item represents a distinct visual element that can be found in the image. Output ONLY valid JSON that matches the schema exactly.`;

// Map lens names from the planner to ids in the fixed lens set
function normalizeLensIds(lenses) {
  const ids = [];
  for (const lens of lenses) {
    const name = String(typeof lens === 'object' ? lens?.label || lens?.id : lens).trim().toLowerCase();
    const id = Object.keys(LENSES).find(key => key === name || LENSES[key].label.toLowerCase() === name);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// PLANNER - Picks imageType, taskHint and lenses, then transcribes imageText.
// Streams so the lens calls can start as soon as the lens list is written,
// without waiting for imageText (which can be long for documents).
async function runPlanner(imageContent, promptContext, signal, onPlan) {
  const plannerUserPrompt = `Analyze this image and plan a RotorResult. Think of the rotor as a directory of visual contents - a skimmable table of contents for what's visually present.

Classify imageType: "art", "architecture", "landscape", "portrait", "street", "nature", "food", "event", "interior", "fashion", "sports", "wildlife", "photo", "document", "chart", "screenshot", "meme", "product", "map", or "unknown".

Determine taskHint: "skim", "read_text", "data", "social", or "general".

Select 4-7 lenses from this FIXED SET based on what's relevant to the image, ordered most relevant first:

AVAILABLE LENSES (use these exact names):
${Object.values(LENSES).map((lens, i) => `${i + 1}. "${lens.label}" - ${lens.description}`).join('\n')}

LENS SELECTION RULES:
- Documents/Screenshots/Charts: Text, Layout, Data (if applicable), Objects
- Photos with people: People, Objects, Background, Colors
- Landscapes/Nature: Background, Objects, Colors, Style
- Art/Illustrations: Style, Colors, Objects, Layout
- Products: Objects, Colors, Background, Style
- Architecture/Interior: Layout, Objects, Background, Style
- Food: Objects, Colors, Background, Style
- Always prioritize lenses with substantial content
- Skip lenses with little/no relevant content

Extract imageText: Array of all visible text strings (exact text, no quotes in JSON).

${promptContext}

Output JSON with the keys in exactly this order:
{
  "imageType": "...",
  "taskHint": "...",
  "lenses": ["Text", "Objects", ...],
  "imageText": ["..."]
}`;

  const stream = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: generatorSystemPrompt },
      { role: 'user', content: [{ type: 'text', text: plannerUserPrompt }, imageContent] }
    ],
    max_tokens: 1500,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    stream: true
  }, { signal });

  let text = '';
  let plan = null;
  try {
    for await (const chunk of stream) {
      text += chunk.choices[0]?.delta?.content || '';
      if (plan) continue;
      const lensMatch = text.match(/"lenses"\s*:\s*(\[[^\]]*\])/);
      if (lensMatch) {
        let lensIds = [];
        try {
          lensIds = normalizeLensIds(JSON.parse(lensMatch[1]));
        } catch (e) {
          // Handled by the empty check below
        }
        if (lensIds.length === 0) {
          throw new Error('Invalid response structure from OpenAI - planner selected no lenses');
        }
        plan = {
          imageType: text.match(/"imageType"\s*:\s*"([^"]*)"/)?.[1] || 'unknown',
          taskHint: text.match(/"taskHint"\s*:\s*"([^"]*)"/)?.[1] || 'general',
          lensIds
        };
        onPlan(plan);
      }
    }
  } catch (error) {
    // Once the lens calls are running, losing the rest of the stream only costs imageText
    if (!plan || signal.aborted) throw error;
    console.warn('[Planner] Stream failed after lenses were planned:', error.message);
  }

  if (!plan) {
    throw new Error('Invalid response structure from OpenAI - missing lenses array');
  }

  let imageText = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.imageText)) imageText = parsed.imageText;
  } catch (e) {
    console.warn('[Planner] Could not parse imageText (response may have been truncated)');
  }
  return { ...plan, imageText };
}

// LENS GENERATOR - Full items for one lens. One call per lens, run in parallel,
// so total time is the slowest lens rather than every lens added together.
async function runLens(lensId, imageContent, plan, promptContext, signal) {
  const lens = LENSES[lensId];
  const otherLenses = plan.lensIds.filter(id => id !== lensId).map(id => LENSES[id].label);
  const itemRange = lensId === 'text' || lensId === 'layout' ? '4-6' : '4-5';

  const lensUserPrompt = `Analyze this image and generate ONE lens of a RotorResult: the "${lens.label}" lens (${lens.description}). Think of the rotor as a directory of visual contents - a skimmable table of contents for what's visually present.

This image is classified as "${plan.imageType}".${otherLenses.length ? ` The rotor also has these lenses, generated separately: ${otherLenses.join(', ')}. Only include elements that belong in the ${lens.label} lens so items are not repeated across lenses.` : ''}

${promptContext}

Create ${itemRange} items. Each item:
- id: unique identifier (e.g., "text-title-1", "objects-car-1")
- label: Include actual content! Text: "'[text]'" or "'[text]' (type)". Objects: "Red car", "Woman in blue shirt". People: "Person in blue shirt", "Smiling woman". Layout: "Left column", "Top header". Colors: "Deep blue", "Warm orange tones". Background: "Snowy forest", "Urban street". Style: "Impressionist brushwork", "Minimalist design".
- focusSummary: <= 8 words with actual content
- description: 3-4 detailed sentences. Include: (1) What it is/shows with specific details, (2) Exact location and spatial context, (3) Visual characteristics (colors, textures, size, orientation), (4) Relationship to other elements or significance. Be specific and descriptive.
- regionHint: "top-left" | "left" | "center" | "bottom" | etc
- confidence: "high" | "medium" | "low"
- evidence: "visual" | "text" (optional)
- salience: 1-5 (5 = most important)
- subItems: OPTIONAL, only for complex elements (3-4 max). For subItems, provide even MORE detail in descriptions (4-5 sentences): describe the specific feature, its visual properties, its relationship to the parent item, contextual significance, and any notable details that make it distinctive or important to understand the parent element fully.

Output JSON:
{
  "items": [...]
}`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: generatorSystemPrompt },
      { role: 'user', content: [{ type: 'text', text: lensUserPrompt }, imageContent] }
    ],
    max_tokens: 3000,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  }, { signal });

  if (response.choices[0].finish_reason === 'length') {
    throw new Error(`${lens.label} lens hit the output token limit`);
  }

  const result = JSON.parse(response.choices[0].message.content);
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new Error(`Invalid response structure from OpenAI - ${lens.label} lens has no items`);
  }

  addRegionCoords(result.items);
  return { id: lensId, label: lens.label, items: result.items };
}

// Map an error to the errorType/message the extension shows the user
function classifyError(error) {
  const message = error.message || '';
  if (message.includes('API key')) {
    return { errorType: 'Configuration', message: 'OpenAI API key is not configured or invalid' };
  }
  if (message.includes('fetch') || message.includes('network')) {
    return { errorType: 'Network', message: 'Network error while accessing image or OpenAI API' };
  }
  if (message.includes('JSON') || message.includes('parse')) {
    return { errorType: 'Parsing', message: 'Failed to parse response from OpenAI' };
  }
  if (message.includes('rate limit') || message.includes('429')) {
    return { errorType: 'RateLimit', message: 'OpenAI API rate limit exceeded. Please try again later.' };
  }
  if (message.includes('image') || message.includes('URL')) {
    return {
      errorType: 'ImageAccess',
      message: `Cannot access image at URL. The image may require authentication or be blocked. Original error: ${message}`
    };
  }
  return { errorType: 'Unknown', message: message || 'Unknown error' };
}

// API route to describe image. Responds with newline-delimited JSON events so the
// extension can show each part as soon as it is ready:
//   {type: 'altText', altText}
//   {type: 'plan', imageType, taskHint, lenses: [{id, label}]}
//   {type: 'lens', lens}                    (one per lens, in completion order)
//   {type: 'lensError', id, message}
//   {type: 'imageText', imageText}
//   {type: 'altTextError', message}
//   {type: 'error', errorType, message}     (analysis failed; no more lenses coming)
//   {type: 'done'}
app.post('/api/describe-image', async (req, res) => {
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

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const send = (event) => {
    if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(event) + '\n');
  };

  // Check cache
  const cacheKey = getCacheKey(imageUrl, imageBase64, context, pageTitle);
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('Cache hit for:', cacheKey.substring(0, 50));
    send({ type: 'altText', altText: cached.altText });
    send({ type: 'plan', imageType: cached.imageType, taskHint: cached.taskHint, lenses: cached.lenses.map(({ id, label }) => ({ id, label })) });
    for (const lens of cached.lenses) send({ type: 'lens', lens });
    send({ type: 'imageText', imageText: cached.imageText });
    send({ type: 'done' });
    return res.end();
  }

  // Stop paying for OpenAI calls if the extension goes away (panel closed, prefetch cancelled)
  const abortController = new AbortController();
  const { signal } = abortController;
  res.on('close', () => {
    if (!res.writableFinished) {
      console.log('[Server] Client disconnected, cancelling analysis');
      abortController.abort();
    }
  });

  // Extract host domain from imageUrl if available
  let hostDomain = null;
  try {
    if (imageUrl) hostDomain = new URL(imageUrl).hostname;
  } catch (e) {
    // Ignore
  }
  const promptContext = `Context: Page: ${pageTitle || 'N/A'}, Context: ${context || 'N/A'}, Domain: ${hostDomain || 'N/A'}`;

  const startTime = Date.now();
  const elapsed = () => `${Date.now() - startTime}ms`;
  const result = { altText: null, imageType: 'unknown', taskHint: 'general', imageText: [], lenses: [] };
  const lensResults = {};
  const lensPromises = [];
  let altPromise = Promise.resolve();
  let complete = true;

  try {
    const imageContent = await prepareImageContent(imageUrl, imageBase64);
    console.log(`[Server] Image ready in ${elapsed()}`);

    // Low detail is enough for alt-text and much cheaper
    const imageContentLowDetail = {
      ...imageContent,
      image_url: { ...imageContent.image_url, detail: 'low' }
    };

    altPromise = generateAltText(imageContentLowDetail, context, pageTitle, signal)
      .then(altText => {
        console.log(`[Server] Alt-text ready in ${elapsed()}:`, altText);
        result.altText = altText;
        send({ type: 'altText', altText });
      })
      .catch(error => {
        complete = false;
        if (signal.aborted) return;
        console.error('[Server] Alt-text failed:', error.message);
        send({ type: 'altTextError', message: classifyError(error).message });
      });

    const plan = await runPlanner(imageContent, promptContext, signal, (plan) => {
      console.log(`[Server] Plan ready in ${elapsed()}:`, plan.imageType, plan.lensIds.join(', '));
      result.imageType = plan.imageType;
      result.taskHint = plan.taskHint;
      send({
        type: 'plan',
        imageType: plan.imageType,
        taskHint: plan.taskHint,
        lenses: plan.lensIds.map(id => ({ id, label: LENSES[id].label }))
      });

      for (const lensId of plan.lensIds) {
        lensPromises.push(
          runLens(lensId, imageContent, plan, promptContext, signal)
            .then(lens => {
              console.log(`[Server] ${lens.label} lens ready in ${elapsed()} (${lens.items.length} items)`);
              lensResults[lensId] = lens;
              send({ type: 'lens', lens });
            })
            .catch(error => {
              complete = false;
              if (signal.aborted) return;
              console.error(`[Server] ${LENSES[lensId].label} lens failed:`, error.message);
              send({ type: 'lensError', id: lensId, message: classifyError(error).message });
            })
        );
      }
    });

    result.imageText = plan.imageText;
    send({ type: 'imageText', imageText: plan.imageText });

    await Promise.all(lensPromises);
    await altPromise;
    console.log(`[Server] Analysis complete in ${elapsed()}`);

    // Only cache complete results so a failed lens can be retried
    result.lenses = plan.lensIds.map(id => lensResults[id]).filter(Boolean);
    if (complete && !signal.aborted) {
      cache.set(cacheKey, result);
    }
  } catch (error) {
    if (!signal.aborted) {
      console.error('Error describing image:', error);
      send({ type: 'error', ...classifyError(error) });
    }
    await Promise.allSettled([altPromise, ...lensPromises]);
  }

  send({ type: 'done' });
  res.end();
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
