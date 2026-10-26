# CCTS Carbon Market Simulator by Green Path

A Green Path product for training bodies and their members — a
browser-based simulation of India's Carbon Credit Trading Scheme (CCTS), the
intensity-based baseline-and-credit carbon market notified under the Energy
Conservation (Amendment) Act, 2022.

Three modes:
- **Solo vs. AI Operators** — register a company in one of the nine
  CCTS-obligated sectors, run it through the three FY 2025-26 to FY 2027-28
  compliance years, and trade Carbon Credit Certificates (CCCs) against eight
  AI-driven counterparts on a live exchange.
- **Market Simulator** — configure a behavioral mix (firm population,
  starting postures, trading strategies, cost uncertainty) and batch-run a
  Monte Carlo forecast of price and compliance outcomes across hundreds of
  simulated firms and trials.
- **Live Multiplayer** — host a room, share a 4-letter code, each real player
  claims a sector seat; unclaimed seats are AI-filled at kickoff. Server-
  authoritative (see Architecture below).

- **Play it:** open `index.html` (or the deployed URL)
- **How to play:** [`guide.html`](./guide.html) — full rules, glossary, and a
  breakdown of what's grounded in the real scheme vs. illustrative
- **Testing this build:** [`test-guide.html`](./test-guide.html) — a
  checklist across all three modes and how to report what you find

## Architecture

Solo vs. AI and the Market Simulator are pure static HTML/JS — `index.html`
loads the shared simulation engine from `engine.js` (sectors, archetypes, bot
logic, auction clearing) and runs entirely client-side.

Live Multiplayer needs a backend — there's no way around a room needing to be
readable by more than one browser. `api/room.js` is a Vercel serverless
function that persists room state as one JSON blob per room (Vercel Blob,
`rooms/{CODE}.json`) and resolves every phase transition (bot decisions,
auction clearing, settlement) server-side via the same `engine.js`, so every
connected client sees an identical result. Clients poll `GET /api/room`
every ~2s. This means Live Multiplayer only works on the deployed site, not
as a bare static file — see Deploying below.

## Deploying

**Vercel (recommended):** this repo is already connected to a Vercel project
with a linked Blob store — pushes to `main` auto-redeploy. To set it up fresh
elsewhere: import the repo at [vercel.com/new](https://vercel.com/new), then
add a Blob store (`vercel blob create-store <name> --access private --yes`)
so `BLOB_READ_WRITE_TOKEN` is available to `api/room.js`.

**Anywhere else (Solo + Simulator modes only):** any static host works for
`index.html` + `engine.js` + `guide.html`, since those modes have no backend
dependency — GitHub Pages, Netlify, etc. Live Multiplayer needs a platform
that runs `api/room.js` as a serverless/Node function with Blob (or
equivalent KV) storage wired up; it won't work on a plain static host.

## Status

All three modes are built and verified end-to-end (Solo, Market Simulator,
and Live Multiplayer — including a real two-browser-tab join/play/settle
test against the live deployment).

## What's real vs. illustrative

Grounded in CCTS as notified through June 2026: the mechanism design
(intensity-based baseline-and-credit, unlimited banking, no borrowing, 2×
non-compliance penalty), the nine covered sectors, the FY2025-26/FY2026-27
notified targets for Aluminium, Cement, Chlor-Alkali, Pulp & Paper and Iron &
Steel (Iron & Steel has no FY2025-26 target at all), and — for every sector
except Fertilizer — abatement cost curves and baseline intensities built from
government technical-committee MACC workbooks.

Illustrative: reduction targets for the other four sectors (interpolated
within the disclosed envelope), every sector's FY2027-28 target (extrapolated),
Fertilizer's cost curve, company-level financials, lead times, and the price
collar bounds. Full detail in [`guide.html`](./guide.html#honesty).
