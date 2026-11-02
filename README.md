# DuoRadar MVP

A responsive Apple Store pickup availability monitor, defaulting to ZIP 32084 and nationwide best-effort ZIP sampling.

## Start

1. Install Node.js 20+.
2. Open a terminal in this folder and run `npm install`.
3. Copy `.env.example` to `.env`.
4. **Populate `DUO_PARTS` with real US Apple iPhone Duo part numbers.** This is required; no invented SKU values or fake inventory are included.
5. Run `npm run dev`, then open http://localhost:3000.

## Find real part numbers

On apple.com, select the desired iPhone Duo color and storage, open the pickup availability flow, and inspect the browser DevTools Network tab for a request named `pickup-message`. Copy each `parts.0`, `parts.1`, etc. value. Place those values in the comma-separated `DUO_PARTS` setting. Set `DUO_LABELS` in the same order, e.g. `256GB Night Sky,256GB Star White`. Apple may change part numbers and request formats; do not assume numbers from other markets are interchangeable.

## How it works

The Express server calls `https://www.apple.com/shop/retail/pickup-message?pl=true&location=32084&parts.0=...` and parses `body.stores[].partsAvailability[part].pickupDisplay`. All requests happen server-side. It caches responses for at least 60 seconds, handles upstream failures explicitly, deduplicates stores across queried ZIPs, and records observed unavailable-to-available transitions in memory.

### Coverage limitations

Apple's endpoint only returns a limited set of stores near each ZIP. Nationwide mode samples 31 predefined US regions plus the requested ZIP and any `EXTRA_ZIPS` you provide. **It does not guarantee every Apple Store is checked.** Add more ZIPs for improved coverage, or build and maintain a verified store-to-ZIP coverage map. Nationwide checks are sequential and may take time. Do not claim every store is covered until you validate coverage. The backend does not calculate distances or sort by distance; local results reflect Apple's returned nearby stores.

### Monitoring limitations

Restock history exists only while the server process runs and only after consecutive successful observations. The page's auto-refresh works while the browser tab is open; this MVP does not include background alert delivery, persistent database storage, authentication, or push notifications. These are good next features. The API is undocumented and may break or rate-limit. Avoid aggressive polling; never attempt to bypass restrictions.

## Deploy

Use any Node.js 20+ host with a persistent web service, such as Render, Railway, or a VPS. Set the environment variables in the host dashboard, run `npm install`, and start with `npm start`. Static-only hosting like GitHub Pages cannot run the backend. For production, add a database, a dedicated scheduled worker, request throttling, and authentication before opening the service publicly.

## Routes

- `GET /api/config`: configured models and cache settings
- `GET /api/stock?zip=32084&scope=local`: nearby Apple Store pickup check
- `GET /api/stock?zip=32084&scope=national`: ZIP-region sampling
- `GET /api/history`: observed restock events in memory

Independent project, not affiliated with or endorsed by Apple. Availability is not a reservation. Always confirm on Apple's website before traveling.

## Redesigned interface and iPhone 18 Pro Max

The redesigned dashboard includes tabs for iPhone Duo, iPhone 18 Pro Max, and both; a color-by-storage matrix per Apple Store; a favorites star; browser-local watch selections; and observed restock history. The model/color/storage matrix is a UI template. **Only cells with configured Apple part numbers can be checked**. Add `PRO_MAX_PARTS` and `PRO_MAX_LABELS` to `.env` in the same comma-separated format as Duo. Labels must include the exact color text and size, e.g. `256GB Space Black,512GB Silver`. For Duo use `Night Sky` or `Star White`; for Pro Max the included UI colors are `Space Black`, `Silver`, `Desert Titanium`, `Deep Blue`. Verify actual Apple model color and storage offerings and adjust `public/app.js` if needed.

The “Notify” button saves a browser-local watch. If notification permission is granted, it can alert on an observed unavailable-to-available transition **while the page is open and refreshing**. It does not send email, SMS, or background push notifications. No fabricated inventory, distance, historical statistics, or guaranteed restock times are displayed. Browser notification support varies, particularly on iOS; full background notifications require a push service, database, and worker.
