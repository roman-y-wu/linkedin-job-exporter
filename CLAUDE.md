# LinkedIn Job Exporter

Chrome extension (Manifest V3) that adds a "Export PDF" button to LinkedIn job pages.

## Architecture

- `manifest.json` - Extension config, content script injection for linkedin.com/jobs/*
- `content.js` - Main logic: DOM scraping, button injection, PDF generation
- `styles.css` - Export button styling (matches LinkedIn's design language)
- `lib/html2pdf.bundle.min.js` - PDF generation library

## Testing

1. Open `chrome://extensions` with Developer mode enabled
2. Click "Load unpacked" and select this directory
3. Navigate to any LinkedIn job page (https://www.linkedin.com/jobs/view/*)
4. Verify the "Export PDF" button appears near the Apply/Save buttons

## Gotchas

- **LinkedIn DOM selectors break frequently** - When the extension stops working, check `SELECTORS` object in content.js:9-35. LinkedIn updates their class names regularly.
- **SPA navigation** - LinkedIn is a single-page app; the MutationObserver in `init()` handles URL changes without page reload
- **Duplicate injection prevention** - `window.linkedInExporterLoaded` flag prevents multiple injections
