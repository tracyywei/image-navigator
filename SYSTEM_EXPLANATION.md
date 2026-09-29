# Image Rotor System - How It Works

## Overview

The Image Rotor is a browser extension designed for Blind and Low-Vision (BLV) users that provides AI-powered, structured navigation of images. Instead of reading long image descriptions, users can quickly browse and explore image content through organized "lenses" (categories) and drill down into details.

## Architecture

The system consists of three main components:

1. **Browser Extension** (`extension/`)
   - Content script (`content.js`) - Injected into web pages, handles UI and interactions
   - Background script (`background.js`) - Service worker that proxies API calls (bypasses CORS)
   - Manifest (`manifest.json`) - Extension configuration

2. **Backend Server** (`server/`)
   - Express.js server running on `localhost:3001`
   - Handles OpenAI Vision API calls
   - Implements caching and image processing

3. **OpenAI Vision API**
   - Uses `gpt-4o-mini` model for image analysis
   - Generates structured image descriptions

## User Interaction Flow

### Method 1: Right-Click Context Menu
1. User right-clicks on an image
2. Selects "Analyze with Image Rotor"
3. Extension sends image URL to background script
4. Background script proxies request to backend server
5. Server analyzes image and returns structured data
6. Rotor panel appears with analysis

### Method 2: Keyboard Shortcut (Cmd+Shift+U / Ctrl+Shift+U)
1. User presses keyboard shortcut
2. Extension enters "Image Navigation Mode"
3. All images on page are found and numbered
4. User navigates with arrow keys (highlights images)
   - Resting on an image for ~0.7s starts analyzing it in the background, so the rotor is often ready by the time Enter is pressed (only one unopened prefetch runs at a time)
5. Press Enter on desired image to analyze
6. Rotor panel opens for that image

### Method 3: Toolbar Button
1. User clicks extension icon
2. Enters image selection mode
3. Clicks on an image
4. Rotor panel opens

## AI Processing Pipeline

### Step 1: Image Preparation
- Extension tries to convert image to Base64 (for CORS bypass), downscaled to what OpenAI's high-detail mode keeps (fits 2048px, short side 768px)
- If that fails, sends image URL to backend
- Backend fetches image server-side (bypasses browser CORS)
- Backend resizes the image the same way with `sharp` and converts it to Base64 for the OpenAI API

### Step 2: Parallel, Streamed API Calls
Latency is dominated by how many tokens the model writes (~100 tokens/s), so the work is split into calls that run at the same time. The server streams each result to the extension as soon as it is ready (newline-delimited JSON, forwarded by the background script over a port), and the rotor fills in progressively.

**Alt-Text Generation**
- Uses **low detail** image processing (faster)
- Generates concise alt-text (1-2 lines)
- Max tokens: 100
- Temperature: 0.2
- Shown and spoken as soon as it arrives (~3s)

**Planner**
- Uses **high detail** image processing
- Streams `imageType`, `taskHint`, the selected lenses, then `imageText`
- As soon as the lens list is written (~2.5s), the server starts the lens calls without waiting for `imageText`

**Lens Generation (one call per lens)**
- Uses **high detail** image processing
- Generates the items (and optional subItems) for one lens
- Each call is told which other lenses exist so items are not repeated across lenses
- Max tokens: 3000 per lens; a lens that fails or hits the limit is reported on its own and the other lenses still load
- Temperature: 0.1
- Runs in parallel, so the rotor is complete when the slowest lens finishes (~8s) rather than after one long call (~19s)

### Step 3: RotorResult Structure
The generator creates a structured JSON response:

```json
{
  "altText": "Short description",
  "imageText": ["Text found in image"],
  "imageType": "document" | "chart" | "photo" | etc.,
  "taskHint": "skim" | "read_text" | "data" | "general",
  "lenses": [
    {
      "id": "text",
      "label": "Text",
      "items": [
        {
          "id": "text-title-1",
          "label": "Text: 'Welcome to Gallery'",
          "focusSummary": "'Welcome' at top center",
          "description": "The text 'Welcome to Our Gallery' appears...",
          "regionHint": "top-center",
          "confidence": "high",
          "evidence": "text",
          "salience": 5,
          "subItems": [...] // Optional drill-down items
        }
      ]
    },
    {
      "id": "objects",
      "label": "Objects",
      "items": [...]
    }
  ]
}
```

### Step 4: Dynamic Lens Generation
The AI dynamically determines which lenses to create based on image type:

- **Standard lenses**: Text, Objects, Layout, Data, People, Style
- **Specialized lenses** (by image type):
  - Art → "Artwork Details", "Composition", "Technique"
  - Architecture → "Architectural Features", "Structural Elements"
  - Documents → "Sections", "Headings", "Content Blocks"
  - Charts → "Data Points", "Trends", "Labels"
  - Screenshots → "UI Elements", "Content", "Navigation"
  - etc.

**Text Lens Priority**: Only included when text is an **important** part of the image (documents, charts, screenshots). Not included for incidental text like watermarks.

## Data Structures

### RotorItem
Each visual element in the image is represented as a RotorItem:

- `id`: Unique identifier (e.g., "text-title-1")
- `label`: Short, skimmable name with actual content
- `focusSummary`: ≤8 words, quick preview (spoken on focus)
- `description`: 2-3 sentences, detailed explanation (spoken on select)
- `regionHint`: Location string ("top-left", "center", etc.)
- `regionHintCoords`: Converted to pixel coordinates for highlighting
- `confidence`: "high" | "medium" | "low"
- `evidence`: "visual" | "text" (optional)
- `salience`: 1-5 (importance score for predictive ordering)
- `subItems`: Optional array for drill-down navigation

### RotorLens
A category of visual elements:

- `id`: Lowercase, hyphenated (e.g., "artwork-details")
- `label`: Display name (e.g., "Artwork Details")
- `items`: Array of RotorItems (4-5 items max)

## UI Components

### Rotor Panel
A side panel that appears on the right side of the screen:

- **Header**: Alt-text display, lens navigation buttons, speed control, close button
- **Left Panel**: List of items in current lens (numbered, skimmable)
- **Right Panel**: Detailed description of selected item
- **Image Overlay**: Visual highlight showing item location

### Keyboard Navigation

**When Rotor is Focused:**
- `R`: Toggle rotor focus on/off
- `←` `→`: Switch between lenses (non-circular, stops at boundaries)
- `↑` `↓`: Navigate items (non-circular, plays sound at boundaries)
- `Enter`: Select item (shows description, or drills down if sub-items exist)
- `Backspace`: Drill up from sub-items
- `+` `-`: Increase/decrease voice speed
- `Esc`: Close rotor

**When Rotor is NOT Focused:**
- Arrow keys navigate the page normally
- `R` activates rotor focus

**Image Navigation Mode:**
- `Cmd+Shift+U` / `Ctrl+Shift+U`: Start image navigation
- Arrow keys: Navigate between images on page
- Enter: Analyze focused image
- Escape: Exit navigation mode

## Predictive Ordering

Items within each lens are re-ordered based on:

1. **AI Salience** (2.0x weight) - Importance score from AI
2. **Usage Stats** (1.0x weight) - How often user clicks each item
3. **Recency Boost** (0.5x weight) - Recently selected items ranked higher
4. **Context Match** (0.5x weight) - Lens + image type compatibility

Stats are stored in `chrome.storage.local` and persist across sessions.

## Drill-Down Navigation

Some items have `subItems` for hierarchical exploration:

- **People**: Facial features, Clothing, Pose, Expression
- **Objects**: Shape, Color, Size, Position, Material
- **Text**: Font style, Size, Color, Position, Content
- **Charts**: Data points, Axes, Legend, Trends

**Navigation:**
- `Enter` on item with sub-items → Drills down
- `Backspace` → Drills back up
- Stack-based navigation preserves history

## Caching

### Server-Side Cache
- In-memory Map cache
- Key: Image hash + context hash
- Prevents redundant API calls for same image
- Only complete results are cached, so a failed lens is retried next time

### Client-Side Analysis Cache
- In-memory per page, keyed by image URL
- Holds in-progress analyses too, so opening an image that is being prefetched picks up where the prefetch is
- Closing the panel (or moving on from a prefetched image) cancels an unfinished analysis, which also cancels the server's OpenAI calls

### Client-Side Cache
- Usage statistics for predictive ordering
- Voice speed preferences
- Stored in `chrome.storage.local`

## Performance Optimizations

1. **Parallel API Calls**: Alt-text, planner and one call per lens run simultaneously
2. **Streaming**: Alt-text and each lens are shown as soon as they are ready
3. **Prefetch**: Keyboard navigation starts analyzing the image the user rests on
4. **Low Detail for Alt-Text**: Faster processing (doesn't need fine details)
5. **Image Downscaling**: Images are sent at the size OpenAI actually uses, since the image is uploaded once per call
6. **Lower Temperature**: 0.1 for faster, deterministic responses

**Measured on a 1280x853 street photo:** alt-text at ~2.8s and all four lenses at ~8.4s, versus ~19.4s for everything with the previous single generator call. Sending the image to one call per lens costs more image input tokens per analysis.

## Accessibility Features

1. **ARIA Live Regions**: Screen reader announcements
2. **Keyboard Navigation**: Full keyboard support, no mouse required
3. **Non-Circular Scrolling**: Clear boundaries with sound feedback
4. **Boundary Sounds**: Audio cue when reaching list start/end
5. **Focus Management**: Clear focus indicators
6. **Voice Speed Control**: Adjustable TTS speed (0.5x - 2.0x)

## Error Handling

The system handles various error types:

- **Configuration**: Missing API key
- **Network**: Server unreachable, connection issues
- **RateLimit**: OpenAI API rate limit exceeded
- **ImageAccess**: CORS issues, authentication required
- **Parsing**: Invalid JSON response

Each error type provides user-friendly messages and fallback behavior.

## Technical Details

### CORS Bypass
- Browser extensions can't directly call `localhost` from HTTPS pages
- Solution: Content script → Background script → Backend server
- Background script acts as proxy, bypassing CORS restrictions

### Image Processing
- Extension tries Base64 conversion first
- If CORS blocks it, sends URL to backend
- Backend fetches image server-side (no CORS restrictions)
- Converts to Base64 before sending to OpenAI

### State Management
- All state managed in content script
- No external state management library
- Uses closures and module pattern for encapsulation


