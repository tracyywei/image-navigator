# Image Rotor Chrome Extension

A browser extension that helps users understand images through structured, screen-reader-first navigation with multiple lenses (Objects, Layout, Style).

## Installation

### Load as Unpacked Extension (Development)

1. **Convert SVG icons to PNG** (required by Chrome):
   - Open each SVG file in a browser and take screenshots, or
   - Use an online SVG to PNG converter
   - Save as `icon16.png`, `icon48.png`, `icon128.png` in the `icons/` folder

2. **Load in Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `extension` folder

3. **Load in Firefox** (alternative):
   - Open Firefox and navigate to `about:debugging`
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select any file in the `extension` folder

## Usage

### Method 1: Toolbar Button
1. Click the Image Rotor icon in your browser toolbar
2. A hint will appear: "Click on an image to analyze"
3. Click any image on the page
4. The Image Rotor panel opens with the image analysis

### Method 2: Right-Click Context Menu
1. Right-click on any image
2. Select "Analyze with Image Rotor"
3. The panel opens immediately with that image

## Keyboard Controls

| Key | Action |
|-----|--------|
| `R` | Toggle rotor focus |
| `←` `→` | Switch between lenses (Objects, Layout, Style) |
| `↑` `↓` | Navigate items within current lens |
| `Enter` | Select focused item |
| `Esc` | Close the rotor panel |

## Features

- **Alt Text Display**: Shows the image's alt text prominently with text-to-speech
- **Three Lenses**: Explore images through Objects, Layout, and Style perspectives
- **Region Highlights**: Visual overlays show where elements are located
- **Screen Reader Support**: Full ARIA live regions and keyboard navigation
- **Text-to-Speech**: Automatic reading of descriptions using Web Speech API

## Current Limitations

This is a **demo/prototype** version. The image analysis is generated with placeholder data. In a production version, you would integrate with an AI service (like GPT-4 Vision or Claude) to generate actual image descriptions.

## Development Notes

- The extension uses Manifest V3
- Content script injects the rotor UI into any webpage
- Background service worker handles context menu and toolbar clicks
- All styles are scoped with `ir-` prefix to avoid conflicts

## Converting to Production

To make this a real image analysis tool:

1. Add an API integration in `content.js` to call an AI vision service
2. Replace `generateDemoAnalysis()` with actual API calls
3. Consider adding a popup or options page for API key configuration
4. Add caching to avoid re-analyzing the same images

## License

MIT
