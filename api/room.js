// Multiplayer room API — server-authoritative state backed by Vercel Blob.
// One JSON blob per room at rooms/{CODE}.json. All game-resolution math
// (bot decisions, auction clearing, settlement) runs here, via engine.js,
// so every connected client sees an identical result.
//
// The action logic below is split into two layers on purpose:
//   - a "pure" layer (createRoomState, advanceRoomPhase, setCbamConfigForRoom,
//     readRoom, publicState, ...) that does the actual work and either
//     returns a value or throws an ApiError — no req/res anywhere.
//   - a thin HTTP-glue layer (actionCreate, actionAdvancePhase, ...) that
//     calls the pure layer and translates the result/error into a response.
// api/cohort.js requires this file and calls the pure layer directly (same
// process, no HTTP round-trip) so a facilitator's bulk actions reuse the
// exact same single-room logic instead of a parallel reimplementation.

const { put, get: blobGet } = require("@vercel/blob");
const engine = require("../engine.js");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0, I/1
const MAX_NAME_LEN = 40;

function ApiError(status, message) {
  var e = new Error(message);
  e.status = status;
  return e;
}

function randomCode() {
  var s = "";
  for (var i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function randomToken() {
  var s = "";
  var chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (var i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function blobToken() {
  var t = process.env.BLOB_READ_WRITE_TOKEN;
  return t ? t.replace(/^"|"$/g, "") : t;
}

function pathFor(code) { return "rooms/" + code + ".json"; }

async function readRoom(code) {
  try {
    // get() resolves to null (does not throw) when the pathname doesn't exist.
    // useCache:false is required — every action here is read-modify-write, and
    // the default cached read served stale state, silently dropping the
    // previous write (observed directly: two sequential joins, the second
    // request's read didn't see the first request's already-persisted seat).
    var result = await blobGet(pathFor(code), { access: "private", token: blobToken(), useCache: false });
    if (!result) return null;
    var text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch (e) {
    if (e && (e.name === "BlobNotFoundError" || /not.?found/i.test(e.message || ""))) return null;
    throw e;
  }
}

async function writeRoom(state) {
  state.version = (state.version || 0) + 1;
  state.updatedAt = new Date().toISOString();
  await put(pathFor(state.code), JSON.stringify(state), {
    access: "private",
    contentType: "application/json",
    token: blobToken(),
    allowOverwrite: true
  });
  return state;
}

function emptySeats() {
  var seats = {};
  engine.SECTORS.forEach(function (s) { seats[s.id] = { claimedBy: null, isHuman: false, archetypeId: null }; });
  return seats;
}

function publicState(state) {
  if (!state) return state;
  var copy = JSON.parse(JSON.stringify(state));
  delete copy.hostToken;
  return copy;
}

function badRequest(res, msg) { res.status(400).json({ error: msg }); }
function notFound(res, msg) { res.status(404).json({ error: msg || "Room not found" }); }
function forbidden(res, msg) { res.status(403).json({ error: msg || "Not authorized" }); }
function conflict(res, msg) { res.status(409).json({ error: msg }); }

function priorPrice(state) {
  var ph = state.priceHistory;
  return ph.length ? ph[ph.length - 1].price : (engine.PRICE_FLOOR + engine.PRICE_CEIL) / 2;
}

function makeDecideAbatement(state) {
  return function (company, sector, year, priceGuess) {
    var seat = state.seats[company.sectorId];
    if (seat.isHuman) {
      var submitted = state.submissions.abatement[company.sectorId];
      if (submitted != null) return engine.clamp(Math.round(submitted), company.activatedCount, 4);
      return company.activatedCount;
    }
    return engine.botChooseAbatement(company, sector, year, priceGuess);
  };
}

function makeDecideProduction(state) {
  return function (company, sector, year, scenario) {
    var seat = state.seats[company.sectorId];
    if (seat.isHuman) {
      var submitted = state.submissions.production[company.sectorId];
      if (submitted != null) return engine.clamp(Number(submitted), 0.5, 1.5);
      return 1;
    }
    return engine.botChooseProduction(company, sector, year, scenario);
  };
}

function makeDecideCbam(state) {
  return function (company, sector, year) {
    if (!state.cbamConfig || !state.cbamConfig.enabled) return { euShare: 0, verify: false };
    var seat = state.seats[company.sectorId];
    if (seat.isHuman) {
      var submitted = state.submissions.cbam[company.sectorId];
      if (submitted != null) {
        return {
          euShare: engine.clamp(Number(submitted.euShare) || 0, 0, 1),
          verify: !!submitted.verify
        };
      }
      return { euShare: 0, verify: false };
    }
    return engine.botChooseCbam(company, sector, year);
  };
}

function makeDecideOrder(state) {
  return function (company, surplusDeficit, priceGuess) {
    var seat = state.seats[company.sectorId];
    if (seat.isHuman) {
      var submitted = state.submissions.trading[company.sectorId];
      if (!submitted) return null;
      var side = surplusDeficit >= 0 ? "sell" : "buy";
      var maxQty = surplusDeficit >= 0 ? Math.max(0, surplusDeficit) : Math.max(0, -surplusDeficit - company.bank);
      var qty = engine.clamp(Number(submitted.qty) || 0, 0, maxQty);
      if (qty <= 0) return null;
      return { side: side, qty: qty, limitPrice: engine.clamp(Number(submitted.limitPrice) || engine.PRICE_FLOOR, engine.PRICE_FLOOR, engine.PRICE_CEIL) };
    }
    return engine.botChooseOrder(company, surplusDeficit, priceGuess);
  };
}

// ---------- pure layer (no req/res — throws ApiError on failure) ----------

async function createRoomState() {
  var code, existing, attempts = 0;
  do {
    code = randomCode();
    existing = await readRoom(code);
    attempts++;
  } while (existing && attempts < 10);
  if (existing) throw ApiError(400, "Could not allocate a room code, try again");

  var hostToken = randomToken();
  var state = {
    code: code,
    hostToken: hostToken,
    version: 0,
    createdAt: new Date().toISOString(),
    phase: "lobby",
    year: 1,
    seats: emptySeats(),
    companies: {},
    submissions: { abatement: {}, production: {}, trading: {}, cbam: {} },
    cbamConfig: { enabled: false, article9Recognized: false },
    priceHistory: [],
    yearData: {}
  };
  await writeRoom(state);
  return { code: code, hostToken: hostToken, state: state };
}

async function setCbamConfigForRoom(code, hostToken, enabled, article9Recognized) {
  var state = await readRoom(code);
  if (!state) throw ApiError(404, "Room not found");
  if (hostToken !== state.hostToken) throw ApiError(403, "Not authorized");
  if (state.phase !== "lobby") throw ApiError(409, "Can only change this before the game starts");
  state.cbamConfig = { enabled: !!enabled, article9Recognized: !!article9Recognized };
  await writeRoom(state);
  return state;
}

async function startGameForRoom(code, hostToken) {
  var state = await readRoom(code);
  if (!state) throw ApiError(404, "Room not found");
  if (hostToken !== state.hostToken) throw ApiError(403, "Not authorized");
  if (state.phase !== "lobby") throw ApiError(409, "Game already started");

  engine.SECTORS.forEach(function (sector) {
    var seat = state.seats[sector.id];
    var archetype = seat.isHuman ? engine.archetypeById(seat.archetypeId) : engine.pick(engine.ARCHETYPES);
    var strategy = seat.isHuman ? null : engine.pick(engine.BOT_STRATEGIES);
    var company = engine.generateCompany(sector, archetype, seat.isHuman, strategy, 0.1, sector.id);
    if (seat.isHuman) company.name = seat.claimedBy + " — " + sector.name + " Works";
    state.companies[sector.id] = company;
  });
  state.phase = "briefing";
  state.year = 1;
  state.yearData = { 1: { scenario: engine.pickScenario() } };
  await writeRoom(state);
  return state;
}

async function advanceRoomPhase(code, hostToken) {
  var state = await readRoom(code);
  if (!state) throw ApiError(404, "Room not found");
  if (hostToken !== state.hostToken) throw ApiError(403, "Not authorized");

  var companies = engine.SECTORS.map(function (s) { return state.companies[s.id]; });
  var yd = state.yearData[state.year] || (state.yearData[state.year] = {});

  if (state.phase === "briefing") {
    state.phase = "abatement";
    state.submissions.abatement = {};
    state.submissions.production = {};
    state.submissions.cbam = {};
  } else if (state.phase === "abatement") {
    var abate = engine.resolveAbatement(companies, state.year, priorPrice(state), makeDecideAbatement(state), makeDecideProduction(state), yd.scenario);
    yd.abate = abate;
    state.phase = "trading";
    state.submissions.trading = {};
  } else if (state.phase === "trading") {
    if (!yd.abate) throw ApiError(409, "Abatement has not been resolved yet");
    var trading = engine.resolveTrading(companies, yd.abate, priorPrice(state), makeDecideOrder(state), state.year, state.cbamConfig, makeDecideCbam(state));
    yd.orders = trading.orders;
    yd.auction = trading.auction;
    yd.settled = trading.settled;
    state.priceHistory.push({ year: state.year, price: trading.auction.clearingPrice });
    state.phase = "settlement";
  } else if (state.phase === "settlement") {
    if (state.year < engine.TOTAL_YEARS) {
      state.year++;
      state.phase = "briefing";
      state.yearData[state.year] = { scenario: engine.pickScenario() };
    } else {
      state.phase = "summary";
    }
  } else {
    throw ApiError(409, "Game already finished");
  }

  await writeRoom(state);
  return state;
}

// ---------- HTTP-glue layer ----------

async function actionCreate(req, res) {
  try {
    var r = await createRoomState();
    res.status(200).json({ code: r.code, hostToken: r.hostToken, state: publicState(r.state) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

async function actionJoin(req, res, body) {
  var code = body.code, seat = body.seat, name = (body.name || "").toString().trim().slice(0, MAX_NAME_LEN);
  if (!code || !seat || !name) return badRequest(res, "code, seat and name are required");
  var state = await readRoom(code);
  if (!state) return notFound(res);
  if (!state.seats[seat]) return badRequest(res, "Unknown seat: " + seat);
  if (state.phase !== "lobby") return conflict(res, "Room has already started");
  if (state.seats[seat].claimedBy) return conflict(res, "Seat already claimed");
  var archetypeId = engine.archetypeById(body.archetypeId) ? body.archetypeId : "midpack";
  state.seats[seat] = { claimedBy: name, isHuman: true, archetypeId: archetypeId };
  await writeRoom(state);
  res.status(200).json({ state: publicState(state) });
}

async function actionSetCbamConfig(req, res, body) {
  try {
    var state = await setCbamConfigForRoom(body.code, body.hostToken, body.enabled, body.article9Recognized);
    res.status(200).json({ state: publicState(state) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

async function actionStartGame(req, res, body) {
  try {
    var state = await startGameForRoom(body.code, body.hostToken);
    res.status(200).json({ state: publicState(state) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

async function actionSubmitAbatement(req, res, body) {
  var state = await readRoom(body.code);
  if (!state) return notFound(res);
  var seat = state.seats[body.seat];
  if (!seat || !seat.isHuman) return badRequest(res, "Not a claimed human seat");
  if (state.phase !== "abatement") return conflict(res, "Not in the abatement window");
  var count = Math.round(Number(body.activatedCount));
  if (!(count >= 0 && count <= 4)) return badRequest(res, "activatedCount must be 0-4");
  state.submissions.abatement[body.seat] = count;
  if (body.productionLevel != null) {
    var level = Number(body.productionLevel);
    if (!(level >= 0.5 && level <= 1.5)) return badRequest(res, "productionLevel must be 0.5-1.5");
    state.submissions.production[body.seat] = level;
  }
  if (body.cbamEuShare != null) {
    var euShare = Number(body.cbamEuShare);
    if (!(euShare >= 0 && euShare <= 1)) return badRequest(res, "cbamEuShare must be 0-1");
    state.submissions.cbam[body.seat] = { euShare: euShare, verify: !!body.cbamVerify };
  }
  await writeRoom(state);
  res.status(200).json({ state: publicState(state) });
}

async function actionSubmitOrder(req, res, body) {
  var state = await readRoom(body.code);
  if (!state) return notFound(res);
  var seat = state.seats[body.seat];
  if (!seat || !seat.isHuman) return badRequest(res, "Not a claimed human seat");
  if (state.phase !== "trading") return conflict(res, "Not in the trading window");
  var qty = Number(body.qty), limitPrice = Number(body.limitPrice);
  if (!(qty >= 0) || !(limitPrice >= 0)) return badRequest(res, "qty and limitPrice must be numbers");
  state.submissions.trading[body.seat] = { qty: qty, limitPrice: limitPrice };
  await writeRoom(state);
  res.status(200).json({ state: publicState(state) });
}

async function actionAdvancePhase(req, res, body) {
  try {
    var state = await advanceRoomPhase(body.code, body.hostToken);
    res.status(200).json({ state: publicState(state) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      var code = (req.query && req.query.code) || "";
      if (!code) return badRequest(res, "code is required");
      var state = await readRoom(code.toString().toUpperCase());
      if (!state) return notFound(res);
      return res.status(200).json({ state: publicState(state) });
    }

    if (req.method === "POST") {
      var body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { return badRequest(res, "Invalid JSON body"); } }
      body = body || {};
      if (body.code) body.code = body.code.toString().toUpperCase();

      switch (body.action) {
        case "create": return await actionCreate(req, res);
        case "join": return await actionJoin(req, res, body);
        case "startGame": return await actionStartGame(req, res, body);
        case "setCbamConfig": return await actionSetCbamConfig(req, res, body);
        case "submitAbatement": return await actionSubmitAbatement(req, res, body);
        case "submitOrder": return await actionSubmitOrder(req, res, body);
        case "advancePhase": return await actionAdvancePhase(req, res, body);
        default: return badRequest(res, "Unknown action: " + body.action);
      }
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("room API error", e);
    res.status(500).json({ error: "Internal error", message: e && e.message });
  }
};

// Exposed for api/cohort.js to call the pure layer in-process — a
// facilitator's bulk actions reuse this exact single-room logic rather
// than a parallel reimplementation.
module.exports.createRoomState = createRoomState;
module.exports.advanceRoomPhase = advanceRoomPhase;
module.exports.setCbamConfigForRoom = setCbamConfigForRoom;
module.exports.startGameForRoom = startGameForRoom;
module.exports.readRoom = readRoom;
module.exports.publicState = publicState;
module.exports.ApiError = ApiError;
