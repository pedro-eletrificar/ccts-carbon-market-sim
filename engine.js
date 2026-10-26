/* CCTS simulation engine — shared, pure logic.
   Loaded as a plain script in the browser (Solo / Simulator modes) AND
   required as a CommonJS module by the multiplayer serverless function
   (api/room.js), so every mode resolves a compliance year identically.
   No DOM, no fetch, no globals beyond what's declared here. */

// fy28 is not disclosed anywhere in the source deck (CCTS has only notified
// FY25-26 and FY26-27 targets to date) — it's a linear extrapolation of each
// sector's own fy26->fy27 trend, always flagged "(extrapolated)" in the UI
// regardless of whether fy26/fy27 for that sector are real or illustrative.
//
// costTiers/fractionTiers replace the old universal MEASURE_COST_TIERS /
// MEASURE_FRACTION_TIERS with a real, sector-specific marginal abatement
// cost curve for the 8 sectors the Government of India's MACC calculation
// workbooks (used in setting the CCTS targets) cover — every sector but Fertilizer. Each is 4 numbers:
// sort every named real technology in that sector's workbook by INR/tCO2,
// then cut the resulting cost curve into 4 equal-width blocks by
// cumulative abatement potential (splitting a technology across a block
// boundary when a single real lever — e.g. Chlor-Alkali's "26% RE
// utilization" alone — is bigger than one block), and take each block's
// potential-weighted average cost. That's why fractionTiers is the same
// number four times per sector: by construction each block captures
// exactly one quarter of that sector's total identified real potential;
// what changes tier to tier is cost, which is the actual MACC shape (cheap
// efficiency/O&M levers first — several sectors even open net-negative,
// i.e. profitable — then progressively pricier capital projects).
// baseline is that same workbook's real FY23-24 g CO2/kg figure (Fertilizer
// has no workbook and keeps its earlier illustrative baseline). Source
// files: MAC Aluminium/Alumina calculation Jan2025, MAC Cement_Calculation
// 2409 (corrected), Chlor Alkali MAC calculations 31012025, Paper_MACC_R2,
// Petrochemical/Refinery sector MAC calculations, Steel_MAC_after_TCM,
// Textile_MACC — see guide.html Section 7 / 13.
var SECTORS = [
  { id: "aluminium", name: "Aluminium", unit: "tonne primary Al", baseline: 16.432, fy26: 1.9, fy27: 7.06, fy28: 12.22, margin: 2400, outMin: 40000, outMax: 90000,
    costTiers: [-298, 296, 1895, 3320], fractionTiers: [0.0367, 0.0367, 0.0367, 0.0367] },
  { id: "steel", name: "Iron & Steel", unit: "tonne crude steel", baseline: 2.768, fy26: 0, fy27: 5.5, fy28: 11.0, margin: 1800, outMin: 150000, outMax: 400000,
    costTiers: [-981, -477, 68, 1972], fractionTiers: [0.0563, 0.0563, 0.0563, 0.0563] },
  { id: "cement", name: "Cement", unit: "tonne cement", baseline: 0.631, fy26: 0.85, fy27: 7.6, fy28: 14.35, margin: 900, outMin: 200000, outMax: 600000,
    costTiers: [-1199, -297, 50, 1554], fractionTiers: [0.0208, 0.0208, 0.0208, 0.0208] },
  { id: "chloralkali", name: "Chlor-Alkali", unit: "tonne caustic soda", baseline: 1.8797, fy26: 1.32, fy27: 4.53, fy28: 7.74, margin: 1500, outMin: 60000, outMax: 150000,
    costTiers: [-785, -309, -129, 1189], fractionTiers: [0.0673, 0.0673, 0.0673, 0.0673] },
  { id: "pulp", name: "Pulp & Paper", unit: "tonne paper", baseline: 1.230, fy26: 7.0, fy27: 15.0, fy28: 23.0, margin: 1100, outMin: 80000, outMax: 200000,
    costTiers: [-4388, -423, 710, 2244], fractionTiers: [0.0551, 0.0551, 0.0551, 0.0551] },
  { id: "fertilizer", name: "Fertilizer", unit: "tonne urea", baseline: 1.8, fy26: 2.0, fy27: 4.5, fy28: 7.0, margin: 1300, outMin: 250000, outMax: 500000,
    costTiers: [400, 1200, 2800, 5500], fractionTiers: [0.02, 0.035, 0.05, 0.07] },
  { id: "refining", name: "Petroleum Refining", unit: "tonne throughput", baseline: 0.217, fy26: 2.2, fy27: 5.0, fy28: 7.8, margin: 2000, outMin: 1000000, outMax: 3000000,
    costTiers: [-7320, -4042, -1677, 432], fractionTiers: [0.0403, 0.0403, 0.0403, 0.0403] },
  { id: "petrochem", name: "Petrochemicals", unit: "tonne product", baseline: 0.977, fy26: 2.8, fy27: 5.5, fy28: 8.2, margin: 1700, outMin: 100000, outMax: 250000,
    costTiers: [-3704, -298, 1327, 1333], fractionTiers: [0.0361, 0.0361, 0.0361, 0.0361] },
  { id: "textiles", name: "Textiles", unit: "tonne fabric", baseline: 2.097, fy26: 2.0, fy27: 3.5, fy28: 5.0, margin: 600, outMin: 50000, outMax: 120000,
    costTiers: [-2415, -1242, 835, 1158], fractionTiers: [0.1271, 0.1271, 0.1271, 0.1271] }
];

// steel: every one of the ~255 entities in the Third Schedule (draft G.S.R.
// 517(E), 26 June 2026) gets "-" for compliance year 2025-26 — that
// schedule was only drafted after FY25-26 was already underway, so Iron &
// Steel's real trajectory starts a year late (fy26: 0 above is a real "no
// target," not a placeholder). fy27 (5.5%) is an equal-weighted average
// over a ~26-entity sample of that schedule; real entity-level intensities
// in it range from ~0.14 tCO2e/t (coated/finished products) to 4-8+
// (ferro-alloys) around a baseline near the MACC workbook's own 2.768.
var DISCLOSED_SECTORS = { aluminium: 1, cement: 1, chloralkali: 1, pulp: 1, steel: 1 };

// The real CCTS notifies targets in 3-year blocks; this models one full
// block (FY25-26, FY26-27, FY27-28) so banking has a real cycle to play out
// across instead of stopping right when it would start mattering.
var TOTAL_YEARS = 3;

// Years between committing an abatement measure (capex paid, locked in) and
// it actually reducing emissions — cheap retrofits land same-year, a deep
// process redesign does not. Kept non-decreasing by tier: this is what lets
// effectiveCount() below assume "first not-yet-effective measure means none
// after it are effective either" without re-checking every tier.
var MEASURE_LEAD_TIMES = [0, 1, 1, 2];

// One of these is drawn at the start of every compliance year and shown to
// every operator before they plan production or abatement — a coherent
// macro story (a boom or slump that moves related sectors together) rather
// than independent noise per sector. Demand multipliers are illustrative,
// not sourced from any real forecast. Weights sum to 100.
var GROWTH_SCENARIOS = [
  {
    id: "infra_boom", name: "Infrastructure Push", weight: 15,
    narrative: "A large national infrastructure programme breaks ground — road, rail and housing contracts swell order books for heavy construction inputs.",
    demand: { aluminium: 1.05, steel: 1.12, cement: 1.15, chloralkali: 1.02, pulp: 1.00, fertilizer: 1.00, refining: 1.03, petrochem: 1.03, textiles: 1.00 }
  },
  {
    id: "export_slowdown", name: "Export Slowdown", weight: 15,
    narrative: "Weak global demand and tightening CBAM compliance costs squeeze India's export-facing heavy industry.",
    demand: { aluminium: 0.90, steel: 0.92, cement: 1.00, chloralkali: 1.00, pulp: 0.97, fertilizer: 1.00, refining: 0.96, petrochem: 0.95, textiles: 0.88 }
  },
  {
    id: "recession", name: "Broad Slowdown", weight: 10,
    narrative: "A sharper-than-expected growth slowdown hits industrial demand across the board.",
    demand: { aluminium: 0.88, steel: 0.87, cement: 0.90, chloralkali: 0.93, pulp: 0.92, fertilizer: 0.97, refining: 0.94, petrochem: 0.90, textiles: 0.89 }
  },
  {
    id: "consumer_boom", name: "Consumer & Agri Boom", weight: 15,
    narrative: "Strong rural incomes and a good monsoon lift consumer demand and agricultural input use.",
    demand: { aluminium: 1.00, steel: 1.00, cement: 1.02, chloralkali: 1.02, pulp: 1.08, fertilizer: 1.15, refining: 1.02, petrochem: 1.05, textiles: 1.10 }
  },
  {
    id: "energy_shock", name: "Energy Price Shock", weight: 10,
    narrative: "A spike in global energy prices raises input costs economy-wide and dampens energy-intensive production.",
    demand: { aluminium: 0.93, steel: 0.95, cement: 0.97, chloralkali: 0.90, pulp: 0.94, fertilizer: 0.93, refining: 1.05, petrochem: 0.95, textiles: 0.97 }
  },
  {
    id: "steady", name: "Steady State", weight: 35,
    narrative: "No major shocks this year — demand tracks its normal underlying growth trend.",
    demand: { aluminium: 1.00, steel: 1.00, cement: 1.00, chloralkali: 1.00, pulp: 1.00, fertilizer: 1.00, refining: 1.00, petrochem: 1.00, textiles: 1.00 }
  }
];

function pickScenario() {
  var total = 0;
  for (var i = 0; i < GROWTH_SCENARIOS.length; i++) total += GROWTH_SCENARIOS[i].weight;
  var r = Math.random() * total, acc = 0;
  for (i = 0; i < GROWTH_SCENARIOS.length; i++) { acc += GROWTH_SCENARIOS[i].weight; if (r <= acc) return GROWTH_SCENARIOS[i]; }
  return GROWTH_SCENARIOS[GROWTH_SCENARIOS.length - 1];
}

var ARCHETYPES = [
  { id: "efficient", name: "Efficient Incumbent", desc: "Already lean. Low starting intensity, but the cheap fixes are gone — further cuts cost more.", baselineMult: 0.85, costMult: 1.4, potentialMult: 0.7 },
  { id: "midpack", name: "Mid-Pack Operator", desc: "Sector-average intensity and a balanced abatement cost curve.", baselineMult: 1.0, costMult: 1.0, potentialMult: 1.0 },
  { id: "laggard", name: "Legacy Laggard", desc: "High starting intensity, but plenty of cheap headroom — early cuts are inexpensive.", baselineMult: 1.2, costMult: 0.7, potentialMult: 1.4 }
];

var BOT_STRATEGIES = ["complier", "banker", "frontloader", "laggard_payer"];
var BOT_STRATEGY_LABEL = { complier: "Cost-Minimizing Complier", banker: "Banker / Speculator", frontloader: "Aggressive Early-Abater", laggard_payer: "Laggard Penalty-Payer" };

var PRICE_FLOOR = 500;
var PRICE_CEIL = 6000;

// ---------- optional CBAM module ----------
// Off by default everywhere — every function below is a no-op unless a
// caller explicitly passes an enabled cbamConfig into resolveTrading, so
// existing 5-arg callers (pre-CBAM) see byte-identical behavior.
//
// Real CBAM (Regulation (EU) 2023/956) covers Iron & Steel, Aluminium,
// Cement, Fertilizers, Hydrogen and Electricity — of this simulator's nine
// CCTS sectors, that overlaps with exactly these four.
var CBAM_ELIGIBLE_SECTORS = { aluminium: 1, steel: 1, cement: 1, fertilizer: 1 };
function cbamEligible(sectorId) { return !!CBAM_ELIGIBLE_SECTORS[sectorId]; }

// The definitive-regime certificate obligation only bites on the share of
// embedded emissions NOT still covered by phasing-out EU ETS free
// allocation: 2.5% in 2026, 5% in 2027, 10% in 2028, rising to 100% by 2034.
// This simulator's three years line up with the first three of those.
var CBAM_OBLIGATION_FRACTION = [0.025, 0.05, 0.10];
function cbamObligationFraction(year) { return CBAM_OBLIGATION_FRACTION[year - 1] || 0; }

// Illustrative EU ETS reference price in Rupees (~€80/tCO2e at ~91 INR/EUR),
// deliberately held well above the CCTS collar ceiling — that persistent
// gap between a domestic and an EU carbon price is the entire reason a
// border adjustment exists. Drifts mildly upward year to year, independent
// of whatever the CCTS auction clears at.
var CBAM_EU_ETS_PRICE_BASE = 7280;
var CBAM_EU_ETS_DRIFT = [0, 0.04, 0.09];
function euEtsPrice(year) { return CBAM_EU_ETS_PRICE_BASE * (1 + (CBAM_EU_ETS_DRIFT[year - 1] || 0)); }

// If an operator doesn't submit verified emissions data, the EU applies a
// deliberately punitive default value instead of the true figure — modeled
// here as a flat markup over the company's own unabated baseline, which is
// always worse than any verified actualIntensity a company could report.
var CBAM_DEFAULT_VALUE_MARKUP = 1.5;
// Flat illustrative annual MRV/verification cost — small next to the
// capex figures elsewhere, but real enough that "always verify" isn't a
// free action at very low EU export shares.
var CBAM_VERIFICATION_COST = 1500000;

// Bots take a modest, illustrative EU export share when the module is on
// and their sector is eligible, and default to verifying — the interesting
// variation is a human's own export-share and Article 9 choices, not bot
// guessing.
function botChooseCbam(company, sector, year) {
  if (!cbamEligible(sector.id)) return { euShare: 0, verify: false };
  return { euShare: rnd(0.1, 0.35), verify: true };
}

function rnd(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function sectorById(id) { return SECTORS.filter(function (s) { return s.id === id; })[0]; }
function archetypeById(id) { return ARCHETYPES.filter(function (a) { return a.id === id; })[0]; }

function makeMeasures(ownBaseline, archetype, variance, sector) {
  variance = variance == null ? 0.1 : variance;
  var costTiers = sector.costTiers, fractionTiers = sector.fractionTiers;
  var measures = [];
  for (var i = 0; i < 4; i++) {
    var fraction = fractionTiers[i] * archetype.potentialMult * rnd(1 - variance, 1 + variance);
    // costMult (>1 efficient, <1 laggard) is meant to always read as "worse
    // for efficient, better for laggard" — true by plain multiplication
    // when a tier costs money, but a real MACC tier can be net
    // cost-SAVING (negative INR/tCO2): multiplying a negative number by
    // 1.4 makes the saving *bigger*, i.e. better, which is backwards for
    // "efficient incumbents get worse further-cut economics." Dividing
    // instead for a negative base cost keeps the direction consistent
    // (efficient: a smaller saving or a cost; laggard: a bigger saving)
    // without changing anything for the (still purely positive) tiers this
    // multiplier was originally written for.
    var costBase = costTiers[i];
    var costPerT = (costBase >= 0 ? costBase * archetype.costMult : costBase / archetype.costMult) * rnd(1 - variance, 1 + variance);
    var reductionPerUnit = fraction * ownBaseline;
    measures.push({
      label: ["Efficiency Retrofit", "Fuel/Process Switch", "Advanced Capture", "Deep Process Redesign"][i],
      costPerTonne: costPerT,
      reductionPerUnit: reductionPerUnit
    });
  }
  return measures;
}

function generateCompany(sector, archetype, isPlayer, strategy, variance, idOverride) {
  var ownBaseline = sector.baseline * archetype.baselineMult * rnd(0.95, 1.05);
  var output = Math.round(rnd(sector.outMin, sector.outMax));
  return {
    id: idOverride || sector.id,
    sectorId: sector.id,
    sectorName: sector.name,
    unit: sector.unit,
    name: (isPlayer ? "Your " : "") + sector.name + " Works",
    isPlayer: !!isPlayer,
    archetypeId: archetype.id,
    archetypeName: archetype.name,
    strategy: strategy || null,
    baselineIntensity: ownBaseline,
    output: output,
    margin: sector.margin,
    measures: makeMeasures(ownBaseline, archetype, variance, sector),
    activatedCount: 0,
    commitYear: [null, null, null, null],
    bank: 0,
    totalProfit: 0,
    history: []
  };
}

function targetIntensity(company, sector, year) {
  var reductionPct = year === 1 ? sector.fy26 : year === 2 ? sector.fy27 : sector.fy28;
  return company.baselineIntensity * (1 - reductionPct / 100);
}

// How many of a company's committed measures have actually landed by `year`,
// vs. still being paid-for-but-not-yet-delivering. Committed measures are
// always contiguous from index 0 (cheapest first) and commitYear is
// non-decreasing by index, and MEASURE_LEAD_TIMES is non-decreasing too, so
// effectiveYear-by-index is non-decreasing — the first not-yet-effective
// measure means none after it are effective either, safe to stop there.
function effectiveCount(company, year) {
  var n = 0;
  for (var i = 0; i < company.activatedCount; i++) {
    var cy = company.commitYear[i];
    if (cy != null && year >= cy + MEASURE_LEAD_TIMES[i]) n++;
    else break;
  }
  return n;
}

function cumulativeReduction(company, count) {
  var r = 0;
  for (var i = 0; i < count; i++) r += company.measures[i].reductionPerUnit;
  return r;
}

function newMeasuresCost(company, fromCount, toCount) {
  var cost = 0;
  for (var i = fromCount; i < toCount; i++) {
    cost += company.measures[i].costPerTonne * company.measures[i].reductionPerUnit * company.output;
  }
  return cost;
}

// Bots rationally match supply to demand (plus a little idiosyncratic
// noise, mainly so a Simulator run with dozens of firms per sector isn't
// perfectly identical across firms) — the interesting variation is the
// scenario itself and how a human chooses to react to it, not bot guessing.
function botChooseProduction(company, sector, year, scenario) {
  var demandMult = scenario.demand[sector.id];
  return clamp(demandMult * rnd(0.95, 1.05), 0.5, 1.5);
}

function botChooseAbatement(company, sector, year, priceGuess) {
  var target = targetIntensity(company, sector, year);
  var from = company.activatedCount;
  var count = from;
  if (company.strategy === "frontloader") {
    count = year === 1 ? Math.max(from, 3) : 4;
  } else if (company.strategy === "banker") {
    count = from;
    while (count < 4 && company.measures[count].costPerTonne <= priceGuess * 1.1) count++;
  } else if (company.strategy === "laggard_payer") {
    count = Math.min(from + 1, 1);
  } else {
    // complier: activate just enough to hit target with a small buffer
    count = from;
    while (count < 4) {
      var reduced = cumulativeReduction(company, count);
      var intensity = company.baselineIntensity - reduced;
      if (intensity <= target * 1.02) break;
      count++;
    }
  }
  return clamp(count, from, 4);
}

function botChooseOrder(company, surplusDeficit, priceGuess) {
  // Per-firm price jitter: without it every firm in a strategy bucket names the exact
  // same price, so an auction's clearing price collapses to one of a handful of fixed
  // multiples of priceGuess — fine for a single solo-mode opponent mix, but it flattens
  // the Monte Carlo simulator's price band to a near-flat line across trials.
  var jitter = rnd(0.88, 1.12);
  if (surplusDeficit > 0) {
    var sellQty, minPrice;
    if (company.strategy === "banker") { sellQty = surplusDeficit * 0.35; minPrice = priceGuess * 1.15; }
    else if (company.strategy === "frontloader") { sellQty = surplusDeficit * 0.9; minPrice = priceGuess * 0.85; }
    else { sellQty = surplusDeficit * 0.7; minPrice = priceGuess * 0.95; }
    return { side: "sell", qty: sellQty, limitPrice: clamp(minPrice * jitter, PRICE_FLOOR, PRICE_CEIL) };
  } else if (surplusDeficit < 0) {
    var shortfall = -surplusDeficit;
    var afterBank = Math.max(0, shortfall - company.bank);
    if (afterBank <= 0) return null;
    var buyQty, maxPrice;
    if (company.strategy === "laggard_payer") { buyQty = afterBank * 0.3; maxPrice = priceGuess * 0.7; }
    else if (company.strategy === "banker") { buyQty = afterBank * 0.5; maxPrice = priceGuess * 0.9; }
    else { buyQty = afterBank * 0.85; maxPrice = priceGuess * 1.2; }
    return { side: "buy", qty: buyQty, limitPrice: clamp(maxPrice * jitter, PRICE_FLOOR, PRICE_CEIL) };
  }
  return null;
}

function clearAuction(orders, priorPrice) {
  var bids = orders.filter(function (o) { return o.side === "buy" && o.qty > 0; }).sort(function (a, b) { return b.limitPrice - a.limitPrice; });
  var asks = orders.filter(function (o) { return o.side === "sell" && o.qty > 0; }).sort(function (a, b) { return a.limitPrice - b.limitPrice; });
  if (!bids.length || !asks.length) {
    return { clearingPrice: clamp(priorPrice, PRICE_FLOOR, PRICE_CEIL), fills: {}, matchedTotal: 0, bids: bids, asks: asks };
  }
  // Cumulative qty prefix sums: bids sorted desc by price, asks sorted asc by price.
  var bidCum = [], askCum = [], acc = 0;
  for (var bi = 0; bi < bids.length; bi++) { acc += bids[bi].qty; bidCum.push(acc); }
  acc = 0;
  for (var ai = 0; ai < asks.length; ai++) { acc += asks[ai].qty; askCum.push(acc); }
  function demandAt(p) {
    // largest index where bids[idx].limitPrice >= p (bids sorted desc -> that prefix is contiguous from 0)
    var lo = 0, hi = bids.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (bids[mid].limitPrice >= p) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans >= 0 ? bidCum[ans] : 0;
  }
  function supplyAt(p) {
    var lo = 0, hi = asks.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (asks[mid].limitPrice <= p) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans >= 0 ? askCum[ans] : 0;
  }
  var bestPrice = null, bestQty = -1;
  asks.forEach(function (a) {
    var p = a.limitPrice;
    var matched = Math.min(demandAt(p), supplyAt(p));
    if (matched > bestQty) { bestQty = matched; bestPrice = p; }
  });
  if (bestPrice === null || bestQty <= 0) {
    return { clearingPrice: clamp(priorPrice, PRICE_FLOOR, PRICE_CEIL), fills: {}, matchedTotal: 0, bids: bids, asks: asks };
  }
  var clearingPrice = clamp(bestPrice, PRICE_FLOOR, PRICE_CEIL);
  var fills = {};
  var remaining = bestQty;
  bids.forEach(function (b) {
    if (remaining <= 0 || b.limitPrice < clearingPrice - 1e-9) return;
    var q = Math.min(b.qty, remaining);
    fills[b.companyId] = (fills[b.companyId] || 0) + q;
    remaining -= q;
  });
  remaining = bestQty;
  asks.forEach(function (a) {
    if (remaining <= 0 || a.limitPrice > clearingPrice + 1e-9) return;
    var q = Math.min(a.qty, remaining);
    fills[a.companyId] = (fills[a.companyId] || 0) + q;
    remaining -= q;
  });
  return { clearingPrice: clearingPrice, fills: fills, matchedTotal: bestQty, bids: bids, asks: asks };
}

function weightedPick(items, weights) {
  var total = 0;
  for (var i = 0; i < weights.length; i++) total += weights[i];
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  var r = Math.random() * total, acc = 0;
  for (i = 0; i < items.length; i++) { acc += weights[i]; if (r <= acc) return items[i]; }
  return items[items.length - 1];
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  var idx = clamp(Math.round((p / 100) * (sortedArr.length - 1)), 0, sortedArr.length - 1);
  return sortedArr[idx];
}

/* Split in two because the multiplayer room pauses for a live trading window
   between them (humans submit orders; solo mode's UI does the equivalent
   split across its "abatement" and "trading" screens). `decideAbatement`
   consults a human's submitted choice where one exists and falls back to
   botChooseAbatement otherwise; `decideOrder` does the same for trading. */

function resolveAbatement(companies, year, priceGuess, decideAbatement, decideProduction, scenario) {
  var abate = {};
  companies.forEach(function (c) {
    var sector = sectorById(c.sectorId);
    // Decision-making (bot or human) still reasons in terms of "measures
    // committed," same as before lead times existed — it's the settlement
    // math below that now only counts what's actually landed by this year,
    // which is what makes naive reactive compliance genuinely risky.
    var newCount = decideAbatement(c, sector, year, priceGuess);
    var capex = newMeasuresCost(c, c.activatedCount, newCount);
    for (var i = c.activatedCount; i < newCount; i++) c.commitYear[i] = year;
    c.activatedCount = newCount;
    var target = targetIntensity(c, sector, year);
    var effCount = effectiveCount(c, year);
    var reduced = cumulativeReduction(c, effCount);
    var actualIntensity = c.baselineIntensity - reduced;

    // Capacity (c.output) is fixed at generation; actual output this year is
    // a real decision made against the year's demand scenario. Intensity
    // targets are per-unit, so producing more doesn't change whether you
    // comply — it scales up the tonnage of whatever surplus or deficit you
    // already have, for better or worse.
    var productionLevel = clamp(decideProduction(c, sector, year, scenario), 0.5, 1.5);
    var actualOutput = c.output * productionLevel;
    var demandMult = scenario.demand[sector.id];
    var demandCeiling = c.output * demandMult;
    var sellableFull = Math.min(actualOutput, demandCeiling);
    var excess = Math.max(0, actualOutput - sellableFull);
    // Producing past what the market wants doesn't stop you emitting for
    // it — it just sells at a steep discount, representing dumping into a
    // soft market. Ignoring the outlook is a real, not cosmetic, cost.
    var revenue = c.margin * sellableFull + c.margin * 0.4 * excess;

    var emissions = actualIntensity * actualOutput;
    var allowance = target * actualOutput;
    abate[c.id] = {
      capex: capex, actualIntensity: actualIntensity, target: target, emissions: emissions, allowance: allowance,
      surplusDeficit: allowance - emissions, committedCount: newCount, effectiveCount: effCount,
      productionLevel: productionLevel, actualOutput: actualOutput, demandMult: demandMult, revenue: revenue
    };
  });
  return abate;
}

function resolveTrading(companies, abate, priceGuess, decideOrder, year, cbamConfig, decideCbam) {
  var orders = [];
  companies.forEach(function (c) {
    var sd = abate[c.id].surplusDeficit;
    var o = decideOrder(c, sd, priceGuess);
    if (o && o.qty > 0.5) orders.push({ companyId: c.id, side: o.side, qty: o.qty, limitPrice: o.limitPrice });
  });
  var auction = clearAuction(orders, priceGuess);

  var settled = {};
  companies.forEach(function (c) {
    var ab = abate[c.id];
    var sd = ab.surplusDeficit;
    var filled = auction.fills[c.id] || 0;
    var bankUsed = 0, bought = 0, sold = 0, penalty = 0, penaltyTonnes = 0, bankedNow = 0;
    if (sd >= 0) {
      sold = filled;
      bankedNow = sd - filled;
      c.bank += bankedNow;
    } else {
      var shortfall = -sd;
      bankUsed = Math.min(c.bank, shortfall);
      c.bank -= bankUsed;
      var remaining = shortfall - bankUsed;
      bought = Math.min(filled, remaining);
      var stillShort = remaining - bought;
      if (stillShort > 0.01) { penalty = stillShort * 2 * auction.clearingPrice; penaltyTonnes = stillShort; }
    }
    var netTrade = sold * auction.clearingPrice - bought * auction.clearingPrice;

    // Optional CBAM module: a second, independent carbon cost on whatever
    // share of this year's output is sold into the EU. Entirely separate
    // from the CCTS auction above — it exists alongside it, not instead of
    // it, which is exactly the "do you pay twice" tension the module is
    // built to surface.
    var cbam = null;
    if (cbamConfig && cbamConfig.enabled && cbamEligible(c.sectorId)) {
      var sector = sectorById(c.sectorId);
      var decision = (decideCbam ? decideCbam(c, sector, year, ab, auction.clearingPrice) : null) || { euShare: 0, verify: false };
      var euShare = clamp(decision.euShare || 0, 0, 1);
      var verify = !!decision.verify;
      var euOutput = ab.actualOutput * euShare;
      // Verified data uses the company's real, already-computed intensity;
      // skipping verification means the EU falls back to a deliberately
      // punitive default value instead — always worse than reporting.
      var intensity = verify ? ab.actualIntensity : c.baselineIntensity * CBAM_DEFAULT_VALUE_MARKUP;
      var embeddedEmissions = intensity * euOutput;
      var fraction = cbamObligationFraction(year);
      var certificates = embeddedEmissions * fraction;
      var price = euEtsPrice(year);
      // Article 9: whether this year's CCTS clearing price counts as a
      // "carbon price effectively paid" at all is the live, unresolved
      // policy question — modeled here as a scenario toggle rather than a
      // fixed assumption. When not recognized, deductible is always zero,
      // regardless of what the company actually paid domestically.
      var deductible = cbamConfig.article9Recognized ? Math.min(price, auction.clearingPrice) : 0;
      var cbamCost = Math.max(0, certificates * (price - deductible));
      var verificationCost = verify ? CBAM_VERIFICATION_COST : 0;
      cbam = {
        euShare: euShare, euOutput: euOutput, verified: verify,
        embeddedEmissions: embeddedEmissions, certificates: certificates,
        euEtsPrice: price, deductible: deductible,
        cbamCost: cbamCost, verificationCost: verificationCost
      };
    }

    var yearProfit = ab.revenue - ab.capex - penalty + netTrade - (cbam ? (cbam.cbamCost + cbam.verificationCost) : 0);
    c.totalProfit += yearProfit;
    var rec = { year: year, target: ab.target, actual: ab.actualIntensity, surplusDeficit: sd, bankUsed: bankUsed, bought: bought, sold: sold, bankedNow: bankedNow, penalty: penalty, penaltyTonnes: penaltyTonnes, price: auction.clearingPrice, capex: ab.capex, yearProfit: yearProfit, bankEnd: c.bank, productionLevel: ab.productionLevel, actualOutput: ab.actualOutput, demandMult: ab.demandMult, revenue: ab.revenue, cbam: cbam };
    c.history.push(rec);
    settled[c.id] = rec;
  });

  return { orders: orders, auction: auction, settled: settled };
}

// ---------- debrief counterfactual ----------
// For the post-game debrief: what a simple "Cost-Minimizing Complier"
// strategy (the same botChooseAbatement logic real complier bots use)
// would have produced for this exact company, against the same demand
// scenarios that actually occurred. Deliberately does NOT re-run a
// multi-agent auction — that would require guessing how every other
// company's orders would have changed too. Instead it settles each year's
// surplus/deficit against that year's REAL clearing price, assuming full
// liquidity (always able to fully sell a surplus or buy a deficit at that
// price, so no bank, no penalty). That's a clearly-scoped idealization —
// an upper bound on how well "just comply, nothing fancier" could have
// gone under the conditions that actually played out — not a full replay.
function computeComplierCounterfactual(company, sector, yearScenarios, priceHistory) {
  var cf = {
    baselineIntensity: company.baselineIntensity,
    measures: company.measures,
    output: company.output,
    margin: company.margin,
    activatedCount: 0,
    commitYear: [null, null, null, null],
    strategy: "complier"
  };
  var records = [];
  var cumulativeProfit = 0;
  for (var year = 1; year <= TOTAL_YEARS; year++) {
    var priceGuess = (year > 1 && priceHistory[year - 2]) ? priceHistory[year - 2].price : (PRICE_FLOOR + PRICE_CEIL) / 2;
    var newCount = botChooseAbatement(cf, sector, year, priceGuess);
    var capex = newMeasuresCost(cf, cf.activatedCount, newCount);
    for (var i = cf.activatedCount; i < newCount; i++) cf.commitYear[i] = year;
    cf.activatedCount = newCount;
    var target = targetIntensity(cf, sector, year);
    var effCount = effectiveCount(cf, year);
    var actualIntensity = cf.baselineIntensity - cumulativeReduction(cf, effCount);

    // Runs at 100% of fixed capacity every year — the "safe" baseline
    // doesn't chase demand the way the real production decision could.
    var actualOutput = cf.output;
    var scenario = yearScenarios[year - 1];
    var demandMult = scenario ? scenario.demand[sector.id] : 1;
    var demandCeiling = cf.output * demandMult;
    var sellableFull = Math.min(actualOutput, demandCeiling);
    var excess = Math.max(0, actualOutput - sellableFull);
    var revenue = cf.margin * sellableFull + cf.margin * 0.4 * excess;

    var emissions = actualIntensity * actualOutput;
    var allowance = target * actualOutput;
    var surplusDeficit = allowance - emissions;

    var clearingPrice = priceHistory[year - 1] ? priceHistory[year - 1].price : (PRICE_FLOOR + PRICE_CEIL) / 2;
    var sold = Math.max(0, surplusDeficit);
    var bought = Math.max(0, -surplusDeficit);
    var netTrade = sold * clearingPrice - bought * clearingPrice;
    var yearProfit = revenue - capex + netTrade;
    cumulativeProfit += yearProfit;

    records.push({
      year: year, target: target, actual: actualIntensity, capex: capex,
      actualOutput: actualOutput, revenue: revenue, surplusDeficit: surplusDeficit,
      sold: sold, bought: bought, price: clearingPrice, committedCount: newCount,
      yearProfit: yearProfit, cumulativeProfit: cumulativeProfit
    });
  }
  return records;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SECTORS: SECTORS, DISCLOSED_SECTORS: DISCLOSED_SECTORS, ARCHETYPES: ARCHETYPES,
    BOT_STRATEGIES: BOT_STRATEGIES, BOT_STRATEGY_LABEL: BOT_STRATEGY_LABEL,
    MEASURE_COST_TIERS: MEASURE_COST_TIERS, MEASURE_FRACTION_TIERS: MEASURE_FRACTION_TIERS,
    MEASURE_LEAD_TIMES: MEASURE_LEAD_TIMES, TOTAL_YEARS: TOTAL_YEARS,
    PRICE_FLOOR: PRICE_FLOOR, PRICE_CEIL: PRICE_CEIL,
    GROWTH_SCENARIOS: GROWTH_SCENARIOS, pickScenario: pickScenario,
    rnd: rnd, pick: pick, clamp: clamp,
    sectorById: sectorById, archetypeById: archetypeById,
    makeMeasures: makeMeasures, generateCompany: generateCompany,
    targetIntensity: targetIntensity, cumulativeReduction: cumulativeReduction, newMeasuresCost: newMeasuresCost,
    effectiveCount: effectiveCount,
    botChooseAbatement: botChooseAbatement, botChooseOrder: botChooseOrder, botChooseProduction: botChooseProduction,
    clearAuction: clearAuction, weightedPick: weightedPick, percentile: percentile,
    resolveAbatement: resolveAbatement, resolveTrading: resolveTrading,
    CBAM_ELIGIBLE_SECTORS: CBAM_ELIGIBLE_SECTORS, cbamEligible: cbamEligible,
    CBAM_OBLIGATION_FRACTION: CBAM_OBLIGATION_FRACTION, cbamObligationFraction: cbamObligationFraction,
    CBAM_EU_ETS_PRICE_BASE: CBAM_EU_ETS_PRICE_BASE, euEtsPrice: euEtsPrice,
    CBAM_DEFAULT_VALUE_MARKUP: CBAM_DEFAULT_VALUE_MARKUP, CBAM_VERIFICATION_COST: CBAM_VERIFICATION_COST,
    botChooseCbam: botChooseCbam,
    computeComplierCounterfactual: computeComplierCounterfactual
  };
}
