# NEON 777 Casino Marketing Material Pack

This folder is a studio handoff pack for the casino site. It contains rendered screenshots, a detailed marketing context brief, and an index explaining what each image is meant to show.

## Folder Contents

- `MARKETING_CONTEXT.md` - product, audience, feature, creative, compliance, and technical context for a marketing studio.
- `SCREENSHOT_INDEX.md` - screenshot-by-screenshot usage notes.
- `screenshots/desktop/` - desktop interface captures at 1440 x 1000.
- `screenshots/mobile/` - mobile captures at 390 x 844 CSS viewport, exported at 2x pixel density.
- `screenshots/tablet/` - tablet capture at 820 x 1180.
- `data/screenshot_manifest.json` - machine-readable screenshot inventory.
- `tools/capture-screenshots.js` - repeatable capture script.

## Capture Notes

The screenshots were rendered from the current local `casino.html` frontend and game scripts. Browser-side mock API/socket data was used for marketing-safe logged-in states, so the captures show real interfaces without changing casino user balances, local data files, or production services.

To regenerate the pack from this checkout:

```powershell
node casino-marketing-material-pack\tools\capture-screenshots.js
```

The script serves the current frontend locally, launches Chrome through Puppeteer, captures the selected states, and rewrites `data/screenshot_manifest.json`.
