# Image Rotor Browser Extension

A browser extension that provides AI-powered, structured, screen-reader-first navigation for images using OpenAI Vision API. Features dynamic lenses, predictive ordering, progressive summaries, and text-first prioritization.

## Features

### AI-Powered Analysis (2-Stage Pipeline)
- **Stage 1: Planner** - Quick classification and lens recommendation
- **Stage 2: Generator** - Full RotorResult with all item details
- Uses OpenAI Vision API (gpt-4o-mini) to generate:
  - Canonical alt-text (1-2 lines, factual)
  - Transcribed image text
  - **Dynamic lenses** (2-5 lenses based on image type)
  - Items with focusSummary (micro-summary) and full description
  - Confidence levels (high/medium/low)
  - Salience scores (1-5) for predictive ordering

### Dynamic Lenses
- Lenses adapt to image type (document, chart, photo, screenshot, etc.)
- Text lens automatically prioritized when text is detected
- Common lens types: Text, Objects, Layout, Style, Data, People, UI, etc.

### Predictive Rotor Ordering
- Items re-ranked based on:
  - AI salience score (2.0x weight)
  - Local usage stats (click counts)
  - Recency boost (recently selected items)
  - Context match (lens + image type)
- Toggle available (default: ON)
- Stats persisted in chrome.storage.local

### Progressive Speak-on-Focus Summaries
- **On focus** (arrow keys): Speaks `focusSummary` (≤8 words, debounced)
- **On select** (Enter): Speaks full `description` (immediate, no debounce)
- **Alt-text**: Spoken once on image load
- **Lens switching**: Speaks lens name and description

### Text-First Auto-Prioritization
- When text is detected, Text lens becomes first lens
- Announced: "Text is visible in this image. X text elements found."
- Text items have `evidence: "text"` and higher salience


### Keyboard Navigation
- `R` - Toggle rotor focus
- `←` `→` - Switch between dynamic lenses
- `↑` `↓` - Navigate items (speaks focusSummary)
- `Enter` - Select item (speaks full description with confidence prefix)
- `Esc` - Close rotor

### Caching
- Server-side: Cached by image hash + context hash
- Client-side: Usage stats for predictive ordering

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up OpenAI API Key

Create a `.env` file in the root directory:

```
OPENAI_API_KEY=your_api_key_here
```

Or set it as an environment variable:

```bash
export OPENAI_API_KEY=your_api_key_here
```

### 3. Start the Backend Server

```bash
npm run server
```

The server will run on `http://localhost:3001` by default.

### 4. Load the Extension

1. Open Chrome/Edge and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/` directory

## Usage

1. **Right-click on any image** and select "Analyze with Image Rotor"
2. Or **click the extension icon** to enter image selection mode, then click on an image
3. The rotor panel will open with AI-generated analysis
4. Use keyboard shortcuts to navigate and explore the image

## Project Structure

```
.
├── extension/          # Browser extension files
│   ├── content.js     # Content script (main extension logic)
│   ├── background.js   # Background service worker
│   ├── manifest.json  # Extension manifest
│   └── styles.css     # Extension styles
├── server/            # Backend API server
│   └── index.js       # Express server with OpenAI integration
└── package.json       # Dependencies and scripts
```

## API Endpoints

### POST `/api/describe-image`

Analyzes an image using OpenAI Vision API.

**Request Body:**
```json
{
  "imageUrl": "https://example.com/image.jpg",
  "imageBase64": "data:image/jpeg;base64,...",
  "context": "Surrounding text context",
  "pageTitle": "Page Title"
}
```

**Response:**
```json
{
  "altText": "Description of the image",
  "imageText": ["Text found in image"],
  "lenses": {
    "objects": ["Item 1", "Item 2"],
    "layout": ["Layout element 1"],
    "style": ["Style element 1"]
  },
  "itemDetails": {
    "Item 1": {
      "description": "Detailed description",
      "regionHint": { "x": 10, "y": 20, "width": 30, "height": 40 }
    }
  }
}
```

## Configuration

### Change API Base URL

Edit `extension/content.js` and update the `API_BASE_URL` constant:

```javascript
const API_BASE_URL = 'http://localhost:3001';
```

### Change Server Port

Set the `PORT` environment variable:

```bash
PORT=3002 npm run server
```

## Development

- **Backend**: `npm run server:dev` (with auto-reload)
- **Extension**: Reload the extension in `chrome://extensions/` after making changes

## License

MIT
