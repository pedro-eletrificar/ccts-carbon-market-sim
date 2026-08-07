/* CCTS simulation engine — shared, pure logic.
   Loaded as a plain script in the browser (Solo / Simulator modes) AND
   required as a CommonJS module by the multiplayer serverless function
   (api/room.js), so every mode resolves a compliance year identically.
   No DOM, no fetch, no globals beyond what's declared here. */

var SECTORS = [
  { id: "aluminium", name: "Aluminium", unit: "tonne primary Al", baseline: 13.5, fy26: 1.9, fy27: 7.06, margin: 2400, outMin: 40000, outMax: 90000 },
  { id: "steel", name: "Iron & Steel", unit: "tonne crude steel", baseline: 2.3, fy26: 2.5, fy27: 6.0, margin: 1800, outMin: 150000, outMax: 400000 },
  { id: "cement", name: "Cement", unit: "tonne cement", baseline: 0.68, fy26: 0.85, fy27: 7.6, margin: 900, outMin: 200000, outMax: 600000 },
  { id: "chloralkali", name: "Chlor-Alkali", unit: "tonne caustic soda", baseline: 1.8, fy26: 1.32, fy27: 4.53, margin: 1500, outMin: 60000, outMax: 150000 },
  { id: "pulp", name: "Pulp & Paper", unit: "tonne paper", baseline: 1.2, fy26: 7.0, fy27: 15.0, margin: 1100, outMin: 80000, outMax: 200000 },
  { id: "fertilizer", name: "Fertilizer", unit: "tonne urea", baseline: 1.8, fy26: 2.0, fy27: 4.5, margin: 1300, outMin: 250000, outMax: 500000 },
  { id: "refining", name: "Petroleum Refining", unit: "tonne throughput", baseline: 0.28, fy26: 2.2, fy27: 5.0, margin: 2000, outMin: 1000000, outMax: 3000000 },
  { id: "petrochem", name: "Petrochemicals", unit: "tonne product", baseline: 1.0, fy26: 2.8, fy27: 5.5, margin: 1700, outMin: 100000, outMax: 250000 },
  { id: "textiles", name: "Textiles", unit: "tonne fabric", baseline: 0.15, fy26: 2.0, fy27: 3.5, margin: 600, outMin: 50000, outMax: 120000 }
];

var DISCLOSED_SECTORS = { aluminium: 1, cement: 1, chloralkali: 1, pulp: 1 };

var ARCHETYPES = [
  { id: "efficient", name: "Efficient Incumbent", desc: "Already lean. Low starting intensity, but the cheap fixes are gone — further cuts cost more.", baselineMult: 0.85, costMult: 1.4, potentialMult: 0.7 },
  { id: "midpack", name: "Mid-Pack Operator", desc: "Sector-average intensity and a balanced abatement cost curve.", baselineMult: 1.0, costMult: 1.0, potentialMult: 1.0 },
  { id: "laggard", name: "Legacy Laggard", desc: "High starting intensity, but plenty of cheap headroom — early cuts are inexpensive.", baselineMult: 1.2, costMult: 0.7, potentialMult: 1.4 }
];

var BOT_STRATEGIES = ["complier", "banker", "frontloader", "laggard_payer"];
var BOT_STRATEGY_LABEL = { complier: "Cost-Minimizing Complier", banker: "Banker / Speculator", frontloader: "Aggressive Early-Abater", laggard_payer: "Laggard Penalty-Payer" };

var MEASURE_COST_TIERS = [400, 1200, 2800, 5500];
var MEASURE_FRACTION_TIERS = [0.02, 0.035, 0.05, 0.07];
var PRICE_FLOOR = 500;
var PRICE_CEIL = 6000;

function rnd(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function sectorById(id) { return SECTORS.filter(function (s) { return s.id === id; })[0]; }
function archetypeById(id) { return ARCHETYPES.filter(function (a) { return a.id === id; })[0]; }

function makeMeasures(ownBaseline, archetype, variance) {
  variance = variance == null ? 0.1 : variance;
  var measures = [];
  for (var i = 0; i < 4; i++) {
    var fraction = MEASURE_FRACTION_TIERS[i] * archetype.potentialMult * rnd(1 - variance, 1 + variance);
    var costPerT = MEASURE_COST_TIERS[i] * archetype.costMult * rnd(1 - variance, 1 + variance);
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
    measures: makeMeasures(ownBaseline, archetype, variance),
    activatedCount: 0,
    bank: 0,
    totalProfit: 0,
    history: []
  };
}

function targetIntensity(company, sector, year) {
  var reductionPct = year === 1 ? sector.fy26 : sector.fy27;
  return company.baselineIntensity * (1 - reductionPct / 100);
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

function resolveAbatement(companies, year, priceGuess, decideAbatement) {
  var abate = {};
  companies.forEach(function (c) {
    var sector = sectorById(c.sectorId);
    var newCount = decideAbatement(c, sector, year, priceGuess);
    var capex = newMeasuresCost(c, c.activatedCount, newCount);
    var target = targetIntensity(c, sector, year);
    var reduced = cumulativeReduction(c, newCount);
    var actualIntensity = c.baselineIntensity - reduced;
    var emissions = actualIntensity * c.output;
    var allowance = target * c.output;
    c.activatedCount = newCount;
    abate[c.id] = { capex: capex, actualIntensity: actualIntensity, target: target, emissions: emissions, allowance: allowance, surplusDeficit: allowance - emissions };
  });
  return abate;
}

function resolveTrading(companies, abate, priceGuess, decideOrder, year) {
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
    var bankUsed = 0, bought = 0, sold = 0, penalty = 0, bankedNow = 0;
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
      if (stillShort > 0.01) penalty = stillShort * 2 * auction.clearingPrice;
    }
    var revenue = c.margin * c.output;
    var netTrade = sold * auction.clearingPrice - bought * auction.clearingPrice;
    var yearProfit = revenue - ab.capex - penalty + netTrade;
    c.totalProfit += yearProfit;
    var rec = { year: year, target: ab.target, actual: ab.actualIntensity, surplusDeficit: sd, bankUsed: bankUsed, bought: bought, sold: sold, bankedNow: bankedNow, penalty: penalty, price: auction.clearingPrice, capex: ab.capex, yearProfit: yearProfit, bankEnd: c.bank };
    c.history.push(rec);
    settled[c.id] = rec;
  });

  return { orders: orders, auction: auction, settled: settled };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SECTORS: SECTORS, DISCLOSED_SECTORS: DISCLOSED_SECTORS, ARCHETYPES: ARCHETYPES,
    BOT_STRATEGIES: BOT_STRATEGIES, BOT_STRATEGY_LABEL: BOT_STRATEGY_LABEL,
    MEASURE_COST_TIERS: MEASURE_COST_TIERS, MEASURE_FRACTION_TIERS: MEASURE_FRACTION_TIERS,
    PRICE_FLOOR: PRICE_FLOOR, PRICE_CEIL: PRICE_CEIL,
    rnd: rnd, pick: pick, clamp: clamp,
    sectorById: sectorById, archetypeById: archetypeById,
    makeMeasures: makeMeasures, generateCompany: generateCompany,
    targetIntensity: targetIntensity, cumulativeReduction: cumulativeReduction, newMeasuresCost: newMeasuresCost,
    botChooseAbatement: botChooseAbatement, botChooseOrder: botChooseOrder,
    clearAuction: clearAuction, weightedPick: weightedPick, percentile: percentile,
    resolveAbatement: resolveAbatement, resolveTrading: resolveTrading
  };
}
