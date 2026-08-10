// Facilitator API — batch-creates several ordinary rooms (see api/room.js)
// under one cohort document, so a trainer running several breakout groups
// can see and advance all of them from one dashboard instead of holding
// N separate host tokens and hopping between N browser tabs.
//
// One JSON blob per cohort at cohorts/{FACILITATOR_CODE}.json, storing
// each member room's own hostToken server-side only — the facilitator's
// browser only ever holds the facilitatorToken, never an individual
// room's hostToken, and bulk actions look the per-room token up here and
// call straight into api/room.js's pure (no-HTTP) layer.

const { put, get: blobGet } = require("@vercel/blob");
const room = require("./room.js");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0, I/1
const MAX_LABEL_LEN = 80;
const MAX_ROOMS = 12;

function randomCode() {
  var s = "";
  for (var i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return "F-" + s; // "F-" prefix keeps facilitator codes visually distinct from 4-letter room codes
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

function pathFor(code) { return "cohorts/" + code + ".json"; }

async function readCohort(code) {
  try {
    var result = await blobGet(pathFor(code), { access: "private", token: blobToken(), useCache: false });
    if (!result) return null;
    var text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch (e) {
    if (e && (e.name === "BlobNotFoundError" || /not.?found/i.test(e.message || ""))) return null;
    throw e;
  }
}

async function writeCohort(cohort) {
  cohort.version = (cohort.version || 0) + 1;
  cohort.updatedAt = new Date().toISOString();
  await put(pathFor(cohort.facilitatorCode), JSON.stringify(cohort), {
    access: "private",
    contentType: "application/json",
    token: blobToken(),
    allowOverwrite: true
  });
  return cohort;
}

function badRequest(res, msg) { res.status(400).json({ error: msg }); }
function notFound(res, msg) { res.status(404).json({ error: msg || "Cohort not found" }); }
function forbidden(res, msg) { res.status(403).json({ error: msg || "Not authorized" }); }

// Cohort docs never carry room hostTokens back to the browser — only room
// codes, which is all a facilitator's UI needs to display or link to.
function publicCohort(cohort) {
  if (!cohort) return cohort;
  return {
    facilitatorCode: cohort.facilitatorCode,
    label: cohort.label,
    createdAt: cohort.createdAt,
    rooms: cohort.rooms.map(function (r) { return { code: r.code }; })
  };
}

async function actionCreate(req, res, body) {
  var roomCount = Math.round(Number(body.roomCount)) || 1;
  if (!(roomCount >= 1 && roomCount <= MAX_ROOMS)) return badRequest(res, "roomCount must be 1-" + MAX_ROOMS);
  var label = (body.label || "").toString().trim().slice(0, MAX_LABEL_LEN);

  var rooms = [];
  for (var i = 0; i < roomCount; i++) {
    var r = await room.createRoomState();
    rooms.push({ code: r.code, hostToken: r.hostToken });
  }

  var facilitatorCode, existing, attempts = 0;
  do {
    facilitatorCode = randomCode();
    existing = await readCohort(facilitatorCode);
    attempts++;
  } while (existing && attempts < 10);

  var facilitatorToken = randomToken();
  var cohort = {
    facilitatorCode: facilitatorCode,
    facilitatorToken: facilitatorToken,
    label: label,
    rooms: rooms,
    createdAt: new Date().toISOString(),
    version: 0
  };
  await writeCohort(cohort);
  res.status(200).json({
    facilitatorCode: facilitatorCode,
    facilitatorToken: facilitatorToken,
    label: label,
    rooms: rooms.map(function (r) { return { code: r.code }; })
  });
}

async function actionState(req, res, body) {
  var cohort = await readCohort(body.facilitatorCode);
  if (!cohort) return notFound(res);
  var states = await Promise.all(cohort.rooms.map(function (r) { return room.readRoom(r.code); }));
  res.status(200).json({
    facilitatorCode: cohort.facilitatorCode,
    label: cohort.label,
    rooms: cohort.rooms.map(function (r, i) { return { code: r.code, state: room.publicState(states[i]) }; })
  });
}

async function actionStartAll(req, res, body) {
  var cohort = await readCohort(body.facilitatorCode);
  if (!cohort) return notFound(res);
  if (body.facilitatorToken !== cohort.facilitatorToken) return forbidden(res);

  var results = [];
  for (var i = 0; i < cohort.rooms.length; i++) {
    var r = cohort.rooms[i];
    try {
      var state = await room.startGameForRoom(r.code, r.hostToken);
      results.push({ code: r.code, ok: true, phase: state.phase });
    } catch (e) {
      results.push({ code: r.code, ok: false, error: e.message });
    }
  }
  res.status(200).json({ results: results });
}

async function actionAdvanceAll(req, res, body) {
  var cohort = await readCohort(body.facilitatorCode);
  if (!cohort) return notFound(res);
  if (body.facilitatorToken !== cohort.facilitatorToken) return forbidden(res);

  var results = [];
  for (var i = 0; i < cohort.rooms.length; i++) {
    var r = cohort.rooms[i];
    try {
      var state = await room.advanceRoomPhase(r.code, r.hostToken);
      results.push({ code: r.code, ok: true, phase: state.phase, state: room.publicState(state) });
    } catch (e) {
      results.push({ code: r.code, ok: false, error: e.message });
    }
  }
  res.status(200).json({ results: results });
}

async function actionAdvanceOne(req, res, body) {
  var cohort = await readCohort(body.facilitatorCode);
  if (!cohort) return notFound(res);
  if (body.facilitatorToken !== cohort.facilitatorToken) return forbidden(res);
  var target = cohort.rooms.filter(function (r) { return r.code === body.roomCode; })[0];
  if (!target) return badRequest(res, "Room " + body.roomCode + " is not part of this cohort");
  try {
    var state = await room.advanceRoomPhase(target.code, target.hostToken);
    res.status(200).json({ code: target.code, phase: state.phase, state: room.publicState(state) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

async function actionSetCbamConfigAll(req, res, body) {
  var cohort = await readCohort(body.facilitatorCode);
  if (!cohort) return notFound(res);
  if (body.facilitatorToken !== cohort.facilitatorToken) return forbidden(res);

  var results = [];
  for (var i = 0; i < cohort.rooms.length; i++) {
    var r = cohort.rooms[i];
    try {
      await room.setCbamConfigForRoom(r.code, r.hostToken, body.enabled, body.article9Recognized);
      results.push({ code: r.code, ok: true });
    } catch (e) {
      results.push({ code: r.code, ok: false, error: e.message });
    }
  }
  res.status(200).json({ results: results });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      var facilitatorCode = (req.query && req.query.facilitatorCode) || "";
      if (!facilitatorCode) return badRequest(res, "facilitatorCode is required");
      var cohort = await readCohort(facilitatorCode.toString().toUpperCase());
      if (!cohort) return notFound(res);
      var states = await Promise.all(cohort.rooms.map(function (r) { return room.readRoom(r.code); }));
      return res.status(200).json({
        facilitatorCode: cohort.facilitatorCode,
        label: cohort.label,
        rooms: cohort.rooms.map(function (r, i) { return { code: r.code, state: room.publicState(states[i]) }; })
      });
    }

    if (req.method === "POST") {
      var body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { return badRequest(res, "Invalid JSON body"); } }
      body = body || {};
      if (body.facilitatorCode) body.facilitatorCode = body.facilitatorCode.toString().toUpperCase();
      if (body.roomCode) body.roomCode = body.roomCode.toString().toUpperCase();

      switch (body.action) {
        case "create": return await actionCreate(req, res, body);
        case "state": return await actionState(req, res, body);
        case "startAll": return await actionStartAll(req, res, body);
        case "advanceAll": return await actionAdvanceAll(req, res, body);
        case "advanceOne": return await actionAdvanceOne(req, res, body);
        case "setCbamConfigAll": return await actionSetCbamConfigAll(req, res, body);
        default: return badRequest(res, "Unknown action: " + body.action);
      }
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("cohort API error", e);
    res.status(500).json({ error: "Internal error", message: e && e.message });
  }
};
