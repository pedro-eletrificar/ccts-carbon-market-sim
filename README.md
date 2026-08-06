# CCTS Carbon Market Simulator

A browser-based simulation of India's Carbon Credit Trading Scheme (CCTS) — the
intensity-based baseline-and-credit carbon market notified under the Energy
Conservation (Amendment) Act, 2022.

Register a company in one of the nine CCTS-obligated sectors, run it through
the FY 2025-26 and FY 2026-27 compliance years, decide how much to spend on
abatement, and trade Carbon Credit Certificates (CCCs) against eight
AI-driven counterparts on a live exchange.

- **Play it:** open `index.html` (or the deployed URL)
- **How to play:** [`guide.html`](./guide.html) — full rules, glossary, and a
  breakdown of what's grounded in the real scheme vs. illustrative

This is a static site — no build step, no dependencies, no server. Any static
host works.

## Deploying

**Vercel (recommended):** go to [vercel.com/new](https://vercel.com/new),
import this repository, and deploy — Vercel auto-detects it as a static site
with no configuration needed. You'll get a `*.vercel.app` URL that
auto-redeploys on every push to `main`.

**Or via the Vercel CLI**, from a local clone:

```bash
npm i -g vercel
vercel --prod
```

**Anywhere else:** GitHub Pages, Netlify, or literally any static file host
will work identically — there is nothing to build.

## Status

Solo-vs-AI mode is playable now. A batch/Monte-Carlo market simulator and a
live multiplayer mode (real players, one per sector) are planned next.

## What's real vs. illustrative

Grounded in CCTS as notified through February 2026: the mechanism design
(intensity-based baseline-and-credit, unlimited banking, no borrowing, 2×
non-compliance penalty), the nine covered sectors, the FY2025-26/FY2026-27
compliance period, and the disclosed reduction ranges for Aluminium, Cement,
Chlor-Alkali, and Pulp & Paper.

Illustrative: reduction targets for the other five sectors (interpolated
within the disclosed envelope), all company-level financials and abatement
cost curves (procedurally generated for gameplay balance), and the price
collar bounds. Full detail in [`guide.html`](./guide.html#honesty).
