# Image Rotor

A screen-reader-compatible Chrome extension and Node server that turn an image into a structure screen-reader users can navigate: an alt-text header, a few semantic **lenses** (Text, People, Objects, ...), and **items** within each lens that open into full descriptions. It extends the screen-reader rotor (VoiceOver, NVDA/JAWS quick navigation) from page structure to image content.

Research prototype from Chapter 3 of my honors thesis, [*Evaluating and Reimagining AI-Driven Image Accessibility on the Web*](https://purl.stanford.edu/fg457hx3385) (Stanford Symbolic Systems, 2026). See full honors thesis here: [https://purl.stanford.edu/fg457hx3385](https://purl.stanford.edu/fg457hx3385)

## Quick start

```bash
npm install
echo "OPENAI_API_KEY=your_key" > .env   # git-ignored
npm run server                          # http://localhost:3001 (npm run server:dev to auto-reload)
```

Then load the extension:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select `extension/`.

After editing extension code, click the reload icon on the Image Rotor card.

There are three ways to open the rotor on an image:

- **Keyboard:** `Cmd/Ctrl+Shift+U` enters image navigation mode. Use the arrow keys to move between images and `Enter` to open one.
- **Right-click:** choose **Analyze with Image Rotor**.
- **Toolbar:** click the extension icon, then click an image.

## How it works

```
content.js ──port──▶ background.js ──POST /api/describe-image──▶ server/index.js ──▶ OpenAI (gpt-4o-mini)
panel, keys, TTS      proxy, relays NDJSON stream                  resize (sharp), cache, parallel calls
```

1. **Capture.** The content script downscales the image to base64 at the size OpenAI uses: it fits within 2048px, with the short side at most 768px. CORS-blocked images fall back to sending the URL, and the server fetches them instead. The script also collects page context: the caption, nearby paragraphs and the page title.
2. **Generate.** The server starts two calls in parallel:
   - **Alt-text:** low detail, using the *Guidelines + Context* prompt from Chapter 2 of the thesis.
   - **Planner:** streams `imageType`, `taskHint`, the lens list and `imageText`. As soon as the lens list appears, one call per lens starts.
3. **Stream.** Each result is sent back as an NDJSON event, and the panel fills in as events arrive. Closing the panel disconnects the port, which cancels the server's OpenAI calls.
4. **Cache.** Results are cached in the page, keyed by image URL, and on the server, keyed by an image + context hash. The server only caches complete results.

In keyboard navigation mode, analysis starts after resting on an image for 700ms. Only one unopened prefetch runs at a time.

On one 1280×853 photo, the alt-text arrived at about 2.8s and all lenses at about 8.4s.

## Lenses and items

The planner picks 4–7 lenses per image from a fixed set:

| Lens | Included when |
|---|---|
| Text | Text is prominent (documents, charts, screenshots, memes, signs) |
| Objects | Physical objects and items (not people) |
| People | People, faces, human figures |
| Layout | Spatial organization, composition, regions, sections |
| Background | Scene setting, environment, surroundings |
| Colors | Dominant colors, color schemes, palette |
| Style | Visual style, artistic technique, aesthetic |
| Data | Charts, graphs, data-visualization elements |

The thesis describes an 11-lens set that adds Structure, Mood and Actions. This code defines the 8 above.

Each lens has 4–6 items. Each item has these fields: `id`, `label`, `focusSummary`, `description`, `regionHint` (converted to `regionHintCoords`), `confidence`, `salience`, and optional `subItems` for one level of drill-down. See [extension/types.js](extension/types.js).

Items are ranked by `salience`, then boosted by the user's past selections, how recently they were selected, and how well the lens fits the image type. To turn this off, set `predictiveOrdering: false` in `chrome.storage.local`.

## Keyboard

| Key | Action |
|---|---|
| `R` | Toggle rotor focus |
| `←` `→` | Switch lens (speaks the lens name) |
| `↑` `↓` | Move between items (speaks the label, plus "Likely inferred" for medium/low confidence) |
| `Enter` | Select item (speaks its description); press again to drill into sub-items |
| `Backspace` | Drill back up |
| `+` `-` | Voice speed (`Cmd/Ctrl+Shift+↑/↓` also works anywhere) |
| `Esc` | Close the rotor |

## API

`POST /api/describe-image` takes this JSON body:

```json
{ "imageUrl": "https://...", "imageBase64": "data:image/jpeg;base64,...", "context": "...", "pageTitle": "..." }
```

Send either `imageUrl` or `imageBase64`. The response is `application/x-ndjson`, one event per line, in completion order:

| Event | Payload |
|---|---|
| `plan` | `imageType`, `taskHint`, `lenses: [{id, label}]` |
| `altText` | `altText` |
| `imageText` | `imageText: string[]` |
| `lens` | `lens: {id, label, items}` |
| `lensError` | `id`, `message` (only that lens failed) |
| `altTextError` | `message` |
| `error` | `errorType`, `message` (the analysis failed) |
| `done` | always the last event |

`GET /health` returns `{ "status": "ok" }`.

## Code map

```
extension/
  content.js      # TTS, predictive ordering, image capture + context, analysis client,
                  # panel rendering, keyboard handling, image navigation mode
  background.js   # context menu, commands, streaming proxy to the server
  manifest.json, styles.css
  types.js        # JSDoc schema for items and lenses (reference only, not loaded)
server/
  index.js        # image resizing, prompts, planner + per-lens calls, NDJSON streaming, cache
```

Where to change things:

| To change | Look at |
|---|---|
| Lens set, planner and lens prompts | `LENSES`, `runPlanner` and `runLens` in `server/index.js` |
| Alt-text prompt | `generateAltText` in `server/index.js` |
| Model | `MODEL` in `server/index.js` |
| Server URL | `API_BASE_URL` in `background.js` (requests) and `content.js` (error messages) |
| Port | the `PORT` environment variable |
| Ordering weights | `PredictiveOrderer.reorderLensItems` in `content.js` |
| Prefetch delay | `PREFETCH_DELAY_MS` in `content.js` |

## Design notes

- **Lenses as headings and landmarks.** A small, fixed lens vocabulary lets a user's mental model carry over from one image to the next. The model chooses which lenses apply, using inclusion rules for each lens written into the prompt.
- **Overview before depth.** Arrow keys speak only short labels, so users can skim. Full descriptions are read only on `Enter`.
- **Uncertainty shown per item.** Medium and low confidence items are marked "(likely)" on screen and "Likely inferred" to screen readers.
- **Formative study (4 blind screen-reader users).** All four rated the rotor 5/5 for ease of use. Text was the most useful lens and Layout the least. Participants wanted to drill into collections, such as one person in a crowd or each bar in a chart, and wanted relations that span lenses, such as who holds which sign. The fixed two-level structure doesn't support either yet.

## License

MIT
