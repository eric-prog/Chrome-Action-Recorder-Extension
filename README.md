## Altera Chrome Extension Takehome

This repository implements a Chrome DevTools Recorder-like extension with a modern UI for recording and replaying user interactions:

- **Record user actions** (click, type, scroll, navigate, viewport) with a Chrome extension
- **Dashboard interface** to manage multiple named recordings with thumbnails
- **Timeline view** showing recorded steps in real-time
- **Inline replay** to test recordings directly in the browser
- **Export recordings** as JSON for external replay with Playwright

### 1) Chrome Extension (Recorder)

Path: `extension/`

**Key Files:**
- `manifest.json`: Manifest V3 configuration with required permissions
- `content.js`: Records user interactions and stores them in `chrome.storage.local`
- `popup.html`/`popup.js`: Modern tabbed UI with Dashboard and Recorder views
- `dashboard.html`/`dashboard.js`: Full-page dashboard for managing recordings

**Installation:**
1. Open Chrome → **Extensions** → Enable **Developer Mode**
2. Click **Load Unpacked** → select the `extension/` folder
3. Pin the extension to your toolbar for easy access

**Usage:**
1. **Dashboard View**: Browse saved recordings with thumbnails and metadata
2. **New Recording**: Click "New recording" → "Start Recording" to begin
3. **Recording**: Interact with any webpage while recording is active (red pulsing dot)
4. **Save**: Give your recording a name and save it to the dashboard
5. **Replay**: Test recordings with inline replay or export for Playwright

**Features:**
- **Persistent Storage**: Recordings saved to Chrome's local storage
- **Smart Selectors**: Prefers stable attributes (`data-testid`, `id`, `aria-label`) with structural fallbacks
- **Visual Timeline**: See recorded steps as you interact with pages
- **Screenshot Thumbnails**: Automatic screenshots for easy recording identification
- **Robust Replay**: Multiple selector strategies for reliable element targeting

**Events Recorded:** `viewport`, `navigate`, `scroll`, `click`, `fill`, `press`

### 2) Replay Script

Path: `replay/replay.js`

**Requirements:** Node.js 18+

**Setup:**
```bash
# Install Playwright (no version pinning)
npm i playwright

# Install browser binaries
npm run install:browsers
```

**Basic Replay:**
```bash
# Replay the example trace
npm run replay:trace

# Replay your own exported recording
node replay/replay.js /path/to/your-exported-recording.json
```

**Advanced Options:**
```bash
# Slow motion replay (milliseconds between actions)
SLOWMO=500 npm run replay:trace

# Capture detailed Playwright trace for debugging
TRACE=1 npm run replay:trace

# Connect to your existing Chrome browser via CDP
# First launch Chrome with debugging enabled:
# /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-prof
CDP=1 CDP_URL=http://localhost:9222 npm run replay:trace
```

**Replay Features:**
- **Multiple Selector Fallbacks**: Tries different selectors if elements change
- **Wait for Visibility**: Ensures elements are visible before interaction
- **Error Handling**: Continues replay with warnings for failed steps
- **Cross-browser Support**: Works with Chrome, Firefox, Safari via Playwright

### 3) Example Trace

Path: `traces/chatgpt-trace.json`

A sample recording demonstrating navigation to ChatGPT. Replace this with your own recordings exported from the extension to test multi-round conversations and Search-mode queries.

### 4) Project Structure

```
takehome/
├── extension/           # Chrome extension files
│   ├── manifest.json   # Extension configuration
│   ├── content.js      # Records user interactions
│   ├── popup.html      # Extension popup UI
│   ├── popup.js        # Popup logic and state management
│   ├── dashboard.html  # Full-page dashboard
│   └── dashboard.js    # Dashboard functionality
├── replay/             # Playwright replay script
│   └── replay.js       # Handles trace replay with multiple strategies
├── traces/             # Example recordings
│   └── chatgpt-trace.json
├── package.json        # Node.js dependencies
└── README.md          # This file
```

### Implementation Highlights

**Selector Strategy:**
- **Primary**: Stable attributes (`data-testid`, `id`, `name`, `aria-label`)
- **Fallback**: Structural CSS selectors (`nth-of-type` paths)
- **Multiple Options**: Each event stores multiple selectors for robustness

**SPA Navigation:**
- Detects client-side routing by wrapping `history.pushState/replaceState`
- Monitors `popstate` events for browser back/forward navigation

**Content Interaction:**
- **Input Elements**: Uses native `value` setting and `input` events
- **Contenteditable**: Focuses element and simulates typing
- **Complex Elements**: Handles various form controls and interactive components

**Storage & State:**
- **Persistent**: All recordings saved to `chrome.storage.local`
- **Session Management**: Tracks recording state across popup open/close
- **Metadata**: Stores timestamps, screenshots, and step counts

### Limitations & Future Enhancements

**Current Limitations:**
- No drag-and-drop or hover event recording
- File upload interactions not captured
- Cross-origin iframe content not accessible
- Text-based selectors not implemented (avoiding non-standard CSS)

**Potential Improvements:**
- Add `:has-text()` equivalent with DOM filtering
- Implement hover and drag-and-drop recording
- Add assertion steps for validation
- Support for mobile/touch events
- Recording performance metrics and timing


