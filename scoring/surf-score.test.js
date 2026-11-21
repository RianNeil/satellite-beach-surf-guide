const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./surf-score.js");

/* Open-Meteo GFS + forecast wind at 12:45 PM ET on 2026-11-21.
   Satellite Beach: about 3.8 ft / 9.1 s, wind about 5 mph gusting 12 from 157°.
   NWS Rip Current Statement was High. These are the model-wind inputs.
   The page prefers the Trident Pier observation for "now" when it is fresh. */
const SAT_NOW = {
  hsFt: 3.806,
  periodS: 9.1,
  swellDir: 74,
  windMph: 4.8,
  gustMph: 11.9,
  windDir: 157,
  shoreFacing: S.SHORE_FACING.satellite,
  tide: { stage: 0.28, rising: true },
  ripRisk: "high",
  hazardsLoaded: true,
  hazardsKnown: true,
  swellSplitKnown: false,
  hoursAhead: 0
};

const CLEAN = {
  hsFt: 2,
  periodS: 8,
  swellDir: 78,
  windMph: 4,
  windDir: 258,
  shoreFacing: 78,
  tide: { stage: 0.5, rising: true },
  ripRisk: "low",
  hazardsLoaded: true,
  hazardsKnown: true,
  swellSplitKnown: true,
  hoursAhead: 0
};

function score(input, level, options) {
  return S.scoreAbility(input, level, options);
}

test("Satellite 2026-11-21 12:45 ET: high rip caps beginners and intermediate stays at or under 8", function () {
  const beginner = score(SAT_NOW, "beginner");
  const intermediate = score(SAT_NOW, "intermediate");
  const advanced = score(SAT_NOW, "advanced");

  assert.equal(beginner.score, 3);
  assert.ok(beginner.uncapped > 3);
  assert.equal(beginner.caps.ripBound, true);
  assert.equal(beginner.verdict, "High rip current risk. Not for beginners today.");
  assert.doesNotMatch(beginner.verdict, /excellent|go now|\bgood\b|\bfair\b|\bpoor\b/i);

  assert.equal(intermediate.score, 7);
  assert.ok(intermediate.score <= 8);
  assert.equal(intermediate.caps.ripBound, true);
  assert.equal(intermediate.caps.splitBound, false);
  assert.match(intermediate.verdict, /high rip current risk/i);
  assert.match(intermediate.notes.join(" "), /stop at 8|not separated/i);

  assert.equal(advanced.score, 5);
  assert.equal(advanced.caps.ripBound, false);
  assert.match(advanced.verdict, /high rip current risk/i);
  [beginner, intermediate, advanced].forEach(function (result) {
    assert.equal(Number.isInteger(result.score), true);
    assert.ok(result.score >= 0 && result.score <= 10);
  });
  assert.ok(S.effectiveWindMph(4.8, 11.9) - 8.925 < 1e-9);
});

test("null wave height or period is No estimate, never a sit-out verdict", function () {
  ["beginner", "intermediate", "advanced"].forEach(function (level) {
    const missingWave = score(Object.assign({}, SAT_NOW, { hsFt: null }), level);
    const missingPeriod = score(Object.assign({}, SAT_NOW, { periodS: null }), level);
    const zeroPeriod = score(Object.assign({}, SAT_NOW, { periodS: 0 }), level);
    [missingWave, missingPeriod, zeroPeriod].forEach(function (result) {
      assert.equal(result.score, null);
      assert.equal(result.verdict, "No estimate");
      assert.equal(result.noEstimate, true);
      assert.doesNotMatch(result.verdict, /poor|sit|fair|good/i);
    });
  });
});

test("moderate rip, with no alert, caps beginners at 6", function () {
  const parsed = S.parseSurfZone([
    "FLZ141-212100-",
    ".REST OF TODAY...",
    "Rip Current Risk*...........Low.",
    "Surf Height.................1 to 2 feet.",
    "$$",
    "FLZ154-647-747-212100-",
    "Southern Brevard Barrier Islands-",
    ".REST OF TODAY...",
    "Rip Current Risk*...........Moderate.",
    "Surf Height.................2 to 3 feet.",
    "Thunderstorm Potential**....None.",
    "$$"
  ].join("\n"), { zone: "FLZ747", issued: { y: 2026, mo: 11, d: 21 } });
  const hazard = S.resolveHazard({
    parsed: parsed,
    alerts: { features: [] },
    wall: { y: 2026, mo: 11, d: 21, h: 13, mi: 0 },
    now: { y: 2026, mo: 11, d: 21, h: 12, mi: 45 }
  });
  assert.equal(hazard.ripRisk, "moderate");
  assert.equal(hazard.loaded, true);
  assert.equal(hazard.nwsSurf.low, 2);
  assert.equal(hazard.nwsSurf.high, 3);

  const result = score(Object.assign({}, CLEAN, {
    ripRisk: hazard.ripRisk,
    hazardsLoaded: hazard.loaded,
    hazardsKnown: hazard.hazardsKnown
  }), "beginner");
  assert.equal(result.score, 6);
  assert.ok(result.uncapped > 6);
  assert.equal(result.caps.ripBound, true);
  assert.match(result.verdict, /moderate rip current risk/i);
  assert.doesNotMatch(result.verdict, /excellent|go now/i);
});

test("18 mph offshore on small surf caps beginners around 5", function () {
  const result = score(Object.assign({}, CLEAN, { windMph: 18, windDir: 258 }), "beginner");
  assert.equal(result.score, 5);
  assert.ok(result.uncapped > 5);
  assert.equal(result.caps.offshoreBound, true);
  assert.match(result.verdict, /paddle back/i);
  assert.equal(result.parts.windLabel, "offshore");
});

test("models that differ by more than 40 percent are low confidence", function () {
  const spread = S.modelSpread([2.493, 3.806, 5.446]);
  assert.equal(spread.lowConfidence, true);
  assert.ok(spread.min < 2.6 && spread.max > 5.4);
  const tight = S.modelSpread([3.6, 3.8, 4.0]);
  assert.equal(tight.lowConfidence, false);
  assert.equal(S.modelSpread([3.8]).lowConfidence, false);
});

test("beyond 24 hours, unknown hazards are not a beginner go-out", function () {
  const result = score({
    hsFt: 2.2,
    periodS: 8.6,
    swellDir: 74,
    windMph: 5,
    windDir: 313,
    shoreFacing: 78,
    tide: { stage: 0.5 },
    ripRisk: null,
    hazardsLoaded: true,
    hazardsKnown: false,
    swellSplitKnown: true,
    hoursAhead: 30
  }, "beginner");
  assert.ok(result.score <= 6);
  assert.equal(result.score, 6);
  assert.equal(result.caps.horizonBound, true);
  assert.match(result.verdict, /aren't confirmed/i);
  assert.doesNotMatch(result.verdict, /excellent|go now|\bgood\b|go out/i);
});

test("tropical or hurricane swell is not scored", function () {
  const fromFlag = score(Object.assign({}, CLEAN, { tropical: true }), "beginner");
  const fromText = score(Object.assign({}, CLEAN, { hazardText: "Swell from Hurricane Example." }), "advanced");
  [fromFlag, fromText].forEach(function (result) {
    assert.equal(result.score, null);
    assert.equal(result.verdict, "No estimate");
    assert.equal(result.reason, "tropical");
    assert.match(result.banner, /National Weather Service/);
    assert.match(result.banner, /tropical or hurricane/i);
  });
});

test("unknown swell split caps intermediate at 8, and high rip still subtracts 1", function () {
  const ideal = {
    hsFt: 3.5,
    periodS: 10,
    swellDir: 80,
    windMph: 8,
    windDir: 260,
    shoreFacing: 78,
    tide: { stage: 0.5 },
    ripRisk: "low",
    hazardsLoaded: true,
    hazardsKnown: true,
    hoursAhead: 0
  };
  const unknown = score(Object.assign({}, ideal, { swellSplitKnown: false }), "intermediate");
  const known = score(Object.assign({}, ideal, { swellSplitKnown: true }), "intermediate");
  const rip = score(Object.assign({}, ideal, { swellSplitKnown: false, ripRisk: "high" }), "intermediate");
  assert.equal(unknown.score, 8);
  assert.ok(unknown.uncapped > 8);
  assert.equal(unknown.caps.splitBound, true);
  assert.equal(known.score, 9);
  assert.equal(known.caps.splitBound, false);
  assert.equal(rip.score, 7);
  assert.equal(rip.caps.ripBound, true);
  assert.equal(S.swellSplitKnown(3.806, 3.74, 0), false);
  assert.equal(S.swellSplitKnown(3.412, 3.15, 0.853), true);
});

test("beginners get no score until rip risk is confirmed, and never Excellent — go now", function () {
  const hidden = score(Object.assign({}, CLEAN, { ripRisk: null, hazardsLoaded: false }), "beginner");
  assert.equal(hidden.score, null);
  assert.equal(hidden.verdict, "No estimate");
  assert.match(hidden.notes.join(" "), /no beginner score/i);

  const nice = score(CLEAN, "beginner");
  assert.equal(nice.score, 10);
  assert.match(nice.verdict, /lifeguard/);
  assert.doesNotMatch(nice.verdict, /excellent|go now|\bgood\b/i);
});

test("chop counts from 0 mph and effective wind uses 0.75 × gust", function () {
  assert.equal(S.effectiveWindMph(5, 12), 9);
  assert.equal(S.effectiveWindMph(10, 12), 10);
  const light = score(Object.assign({}, CLEAN, { windMph: 5, windDir: 78, gustMph: null }), "beginner");
  const calm = score(Object.assign({}, CLEAN, { windMph: 0, windDir: 78, gustMph: 0 }), "beginner");
  assert.ok(light.parts.wind < 8);
  assert.ok(light.parts.wind < calm.parts.wind);
  const gusty = score(SAT_NOW, "beginner");
  const noGust = score(Object.assign({}, SAT_NOW, { gustMph: null }), "beginner");
  assert.ok(gusty.parts.effectiveWind > noGust.parts.effectiveWind);
  assert.ok(gusty.parts.wind < noGust.parts.wind);
});

test("WNW is not scored like side-onshore SE", function () {
  const shared = {
    hsFt: 3,
    periodS: 9,
    swellDir: 78,
    shoreFacing: 78,
    windMph: 12,
    hazardsLoaded: true,
    hazardsKnown: true,
    ripRisk: "low",
    swellSplitKnown: true,
    tide: { stage: 0.5 },
    hoursAhead: 0
  };
  const wnw = score(Object.assign({}, shared, { windDir: 293 }), "intermediate");
  const se = score(Object.assign({}, shared, { windDir: 135 }), "intermediate");
  assert.ok(wnw.parts.onshoreness < 0.2);
  assert.ok(se.parts.onshoreness > 0.7);
  assert.ok(wnw.parts.wind > se.parts.wind + 2);
  assert.equal(wnw.parts.windLabel, "offshore");
  assert.equal(se.parts.windLabel, "side-onshore");
  assert.ok(wnw.score > se.score);
});

test("daytime peaks ignore overnight hours and, today, hours before now", function () {
  const now = { y: 2026, mo: 11, d: 21, h: 12, mi: 45 };
  [0, 1, 2, 3, 7].forEach(function (hour) {
    assert.equal(S.isDaylightHour({ y: 2026, mo: 11, d: 21, h: hour }, now), false);
  });
  assert.equal(S.isDaylightHour({ y: 2026, mo: 11, d: 21, h: 12 }, now), true);
  assert.equal(S.isDaylightHour({ y: 2026, mo: 11, d: 22, h: 1 }, now), false);
  assert.equal(S.isDaylightHour({ y: 2026, mo: 11, d: 22, h: 8 }, now), true);
  assert.equal(S.isDaylightHour({ y: 2026, mo: 11, d: 23, h: 1 }, now), false);
  const peak = S.peakDaytimeWave([
    { wall: { y: 2026, mo: 11, d: 21, h: 0 }, height: 4.921 },
    { wall: { y: 2026, mo: 11, d: 21, h: 2 }, height: 4.659 },
    { wall: { y: 2026, mo: 11, d: 21, h: 13 }, height: 3.806 },
    { wall: { y: 2026, mo: 11, d: 22, h: 1 }, height: 3.609 },
    { wall: { y: 2026, mo: 11, d: 22, h: 8 }, height: 3.412 }
  ], now);
  assert.equal(peak.height, 3.806);
  assert.equal(peak.wall.h, 13);
});

test("wind cells must actually move east of the inland cell", function () {
  const satellite = { lon: -80.5944, inlandLon: -80.62061 };
  assert.equal(S.windCellMoved(satellite, { lat: 28.20315, lon: -80.56134 }), true);
  assert.equal(S.windCellMoved(satellite, { lat: 28.21285, lon: -80.62061 }), false);
  const cocoa = { lon: -80.6018, inlandLon: -80.62277 };
  assert.equal(S.windCellMoved(cocoa, { lat: 28.40057, lon: -80.611755 }), false);
  assert.equal(S.windCellMoved(cocoa, { lat: 28.364725, lon: -80.55787 }), true);
  const melbourne = { lon: -80.557, inlandLon: -80.583374 };
  assert.equal(S.windCellMoved(melbourne, { lat: 28.098703, lon: -80.583374 }), false);
  assert.equal(S.windCellMoved(melbourne, { lat: 28.062885, lon: -80.52971 }), true);
});

test("high rip comes from the statement and from the FLZ747 section, not a different zone", function () {
  const text = [
    "FLZ141-347-447-212100-",
    "Coastal Volusia-",
    ".REST OF TODAY...",
    "Rip Current Risk*...........Low.",
    "Surf Height.................8 to 9 feet.",
    "$$",
    "FLZ154-647-747-212100-",
    "Southern Brevard Barrier Islands-",
    "Including the beaches of Cocoa Beach, Satellite Beach, and Melbourne Beach",
    "...HIGH RIP CURRENT RISK IN EFFECT THROUGH SUNDAY EVENING...",
    ".REST OF TODAY...",
    "Rip Current Risk*...........High.",
    "Surf Height.................4 to 5 feet.",
    "Thunderstorm Potential**....Moderate.",
    ".SUNDAY...",
    "Rip Current Risk*...........High.",
    "Surf Height.................3 to 4 feet.",
    "Thunderstorm Potential**....None.",
    ".MONDAY...Partly sunny. Highs in the mid 70s.",
    "$$"
  ].join("\n");
  const parsed = S.parseSurfZone(text, { zone: "FLZ747", issued: { y: 2026, mo: 11, d: 21 } });
  const alerts = {
    features: [{
      properties: {
        event: "Rip Current Statement",
        headline: "Rip Current Statement issued November 21 at 2:45AM EST until November 22 at 7:00PM EST by NWS Melbourne FL",
        ends: "2026-11-22T19:00:00-05:00",
        expires: "2026-11-22T19:00:00-05:00",
        parameters: { NWSheadline: ["HIGH RIP CURRENT RISK REMAINS IN EFFECT THROUGH SUNDAY EVENING"] }
      }
    }]
  };
  const now = { y: 2026, mo: 11, d: 21, h: 12, mi: 45 };
  const today = S.resolveHazard({
    parsed: parsed,
    alerts: alerts,
    wall: { y: 2026, mo: 11, d: 21, h: 13, mi: 0 },
    now: now
  });
  assert.equal(today.ripRisk, "high");
  assert.equal(today.nwsSurf.low, 4);
  assert.equal(today.nwsSurf.high, 5);
  assert.equal(today.thunder, true);
  assert.equal(today.zone, "FLZ747");
  const copy = S.safetyCopy(today);
  assert.equal(copy.show, true);
  assert.match(copy.text, /FLZ747/);
  assert.match(copy.text, /high rip current risk/i);

  const monday = S.resolveHazard({
    parsed: parsed,
    alerts: alerts,
    wall: { y: 2026, mo: 11, d: 23, h: 8, mi: 0 },
    now: now
  });
  assert.equal(monday.ripRisk, null);
  assert.equal(monday.hazardsKnown, false);
  assert.ok(monday.hoursAhead > 24);

  const sunday = S.resolveHazard({
    parsed: parsed,
    alerts: alerts,
    wall: { y: 2026, mo: 11, d: 22, h: 8, mi: 0 },
    now: now
  });
  assert.equal(sunday.ripRisk, "high");
  assert.equal(sunday.hazardsKnown, true);
});

test("a surf advisory still asks for a banner when rip risk is low", function () {
  const hazard = S.resolveHazard({
    parsed: S.parseSurfZone([
      "FLZ747-212100-",
      ".REST OF TODAY...",
      "Rip Current Risk*...........Low.",
      "Surf Height.................2 to 3 feet.",
      "$$"
    ].join("\n"), { zone: "FLZ747", issued: { y: 2026, mo: 11, d: 21 } }),
    alerts: {
      features: [{
        properties: {
          event: "High Surf Advisory",
          headline: "High Surf Advisory until this evening"
        }
      }]
    },
    wall: { y: 2026, mo: 11, d: 21, h: 13 },
    now: { y: 2026, mo: 11, d: 21, h: 13 }
  });
  assert.equal(hazard.surfAdvisory, true);
  assert.equal(hazard.ripRisk, "low");
  const copy = S.safetyCopy(hazard);
  assert.equal(copy.show, true);
  assert.match(copy.text, /surf advisory/i);
});

test("failed hazard fetch hides the beginner score", function () {
  const hazard = S.resolveHazard({
    parsed: null,
    alerts: null,
    fetchFailed: true,
    wall: { y: 2026, mo: 11, d: 21, h: 13 },
    now: { y: 2026, mo: 11, d: 21, h: 13 }
  });
  assert.equal(hazard.loaded, false);
  assert.equal(hazard.ripRisk, null);
  const copy = S.safetyCopy(hazard);
  assert.equal(copy.show, true);
  assert.match(copy.text, /beginner scores stay hidden/i);
  const result = score(Object.assign({}, CLEAN, {
    hazardsLoaded: hazard.loaded,
    ripRisk: hazard.ripRisk,
    hazardsKnown: hazard.hazardsKnown
  }), "beginner");
  assert.equal(result.score, null);
});

test("gentle mode is an opt-in tighter beginner range", function () {
  const input = Object.assign({}, CLEAN, { hsFt: 3.2 });
  const normal = score(input, "beginner");
  const gentle = score(input, "beginner", { gentle: true });
  assert.ok(gentle.score < normal.score);
  assert.equal(gentle.gentle, true);
  assert.match(gentle.notes.join(" "), /gentle mode/i);
  assert.doesNotMatch(gentle.notes.join(" "), /joint/i);
});

test("shore facing is per beach, not one compass bucket", function () {
  assert.equal(S.SHORE_FACING.cocoa, 88);
  assert.equal(S.SHORE_FACING.satellite, 78);
  assert.equal(S.SHORE_FACING.melbourne, 75);
  assert.equal(S.HAZARD_ZONE, "FLZ747");
  const cocoaOff = S.windWords(88 + 180, S.SHORE_FACING.cocoa);
  assert.equal(cocoaOff.label, "offshore");
});
