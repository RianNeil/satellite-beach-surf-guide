/* Ability scores for the Satellite Beach Surf Guide.
   Vanilla JS. No dependencies. Loaded by the page and by node --test.
   0–10 whole numbers for Beginner, Intermediate, and Advanced.

   Constants follow proposal/ability-score.js where they still hold.
   Safety and correctness changes are called out next to the code. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SurfScore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Shore-facing bearing: the direction the beach faces. A swell from this
     bearing is straight onshore. Offshore wind is this bearing + 180°.

     Derived from the spot coordinates, ocean to the east (Nov 2026):
       Cocoa 28.3678, -80.6018 → Satellite 28.1944, -80.5944
         about 19.3 km south and 0.7 km east, coastline bearing ~178°.
         Facing (left of a southbound walk) ~88°.
       Satellite → Melbourne 28.0684, -80.5570
         about 14.0 km south and 3.7 km east, coastline bearing ~165°.
         Facing ~75°.
       Satellite is on the bend, so 78° (inside 75–80°). */
  var SHORE_FACING = { cocoa: 88, satellite: 78, melbourne: 75 };

  /* Rip alerts for every spot use this land zone. Cocoa's pier coordinates
     resolve to marine zone AMZ552, which does not carry the rip statement. */
  var HAZARD_ZONE = "FLZ747";

  /* Wind-request points that were checked against Open-Meteo on 2026-11-21.
     Satellite lon -80.585 snapped back to the inland cell 28.213, -80.621.
     Satellite lon -80.575 moved to about 28.203, -80.561.
     Cocoa lon -80.575 stayed west of the beach (-80.612). lon -80.560
     moved to about 28.365, -80.558.
     Melbourne at the beach stayed inland (-80.583). lon -80.540 moved
     to about 28.063, -80.530. */
  var WIND_POINTS = {
    satellite: { lat: 28.1944, lon: -80.575, fallbackLon: -80.56, inlandLon: -80.62061 },
    cocoa: { lat: 28.3678, lon: -80.56, fallbackLon: -80.545, inlandLon: -80.62277 },
    melbourne: { lat: 28.0684, lon: -80.54, fallbackLon: -80.52, inlandLon: -80.583374 }
  };

  var DAYLIGHT_START = 7;
  var DAYLIGHT_END = 18;
  var HAZARD_HORIZON_HOURS = 24;
  var OFFSHORE_BEGINNER_CAP = 5;
  var OFFSHORE_BEGINNER_MPH = 15;
  var INTERMEDIATE_UNKNOWN_SPLIT_CAP = 8;

  var PROFILES = {
    beginner: {
      size: [0.5, 1.0, 3.0, 4.5],
      period: [2, 5, 10, 16],
      windRate: 0.65,
      weights: { wind: 0.5, power: 0.35, period: 0.15 },
      setsCap: 5
    },
    intermediate: {
      size: [1.0, 2.5, 4.5, 9.0],
      period: [4, 9, 14, 20],
      windRate: 0.55,
      weights: { wind: 0.55, period: 0.45 },
      setsCap: null
    },
    advanced: {
      size: [1.5, 4.5, 10, 16],
      period: [5, 10, 16, 25],
      windRate: 0.55,
      weights: { wind: 0.5, period: 0.5 },
      setsCap: null
    }
  };

  var GENTLE_SIZE = [0.5, 1.0, 2.5, 3.5];
  var GENTLE_SETS = 4;
  var LEVELS = ["beginner", "intermediate", "advanced"];
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function angDiff(a, b) {
    var d = Math.abs((((a - b) % 360) + 360) % 360);
    return d > 180 ? 360 - d : d;
  }

  function normalizeDeg(deg) {
    return ((deg % 360) + 360) % 360;
  }

  /* k(T) is the proposal shoaling factor: 0.90 at 8 s, +0.05 per second,
     clamped to 0.85–1.20. On 2026-11-21 a 3.8 ft / 9.1 s GFS sea became
     about 3.6 ft of model face, while NWS called the surf 4–5 ft. That
     NWS range is shown on the card. Raising k(T) until the face matched
     4–5 ft collapsed the beginner size score and hid the rip cap. */
  function shoalFactor(periodS) {
    var period = finite(periodS) ? periodS : 8;
    return clamp(0.9 + 0.05 * (period - 8), 0.85, 1.2);
  }

  function breakingFt(hsFt, periodS, swellDir, shoreFacing) {
    if (!finite(hsFt) || !finite(periodS) || periodS <= 0) return null;
    var dir = 1;
    if (finite(swellDir) && finite(shoreFacing)) {
      var off = angDiff(swellDir, shoreFacing);
      dir = off >= 90 ? 0.2 : Math.max(0.3, Math.sqrt(Math.cos((off * Math.PI) / 180)));
    }
    return hsFt * shoalFactor(periodS) * dir;
  }

  function onshoreness(windDir, offshoreDir) {
    if (!finite(windDir) || !finite(offshoreDir)) return null;
    return (1 - Math.cos((angDiff(windDir, offshoreDir) * Math.PI) / 180)) / 2;
  }

  function offshoreDir(shoreFacing) {
    var shore = finite(shoreFacing) ? shoreFacing : SHORE_FACING.satellite;
    return normalizeDeg(shore + 180);
  }

  /* 0 offshore, about 0.5 side-shore, 1 onshore. Not the old 16-point bins.
     WNW/NW stay offshore-side. SE is side-onshore on this coast. */
  function windWords(windDir, shoreFacing) {
    var o = onshoreness(windDir, offshoreDir(shoreFacing));
    var label = "unknown direction";
    if (o == null) label = "unknown direction";
    else if (o < 0.15) label = "offshore";
    else if (o < 0.35) label = "side-offshore";
    else if (o < 0.65) label = "side-shore";
    else if (o < 0.85) label = "side-onshore";
    else label = "onshore";
    return { onshoreness: o, label: label };
  }

  /* Gusts count. The first mph of chop counts. There is no 4–5 mph free pass. */
  function effectiveWindMph(speedMph, gustMph) {
    if (!finite(speedMph) && !finite(gustMph)) return null;
    var speed = finite(speedMph) ? speedMph : 0;
    var gust = finite(gustMph) ? gustMph : 0;
    return Math.max(speed, 0.75 * gust);
  }

  function trap(x, band) {
    if (!finite(x)) return 0;
    if (x <= band[0] || x >= band[3]) return 0;
    if (x < band[1]) return (10 * (x - band[0])) / (band[1] - band[0]);
    if (x <= band[2]) return 10;
    return (10 * (band[3] - x)) / (band[3] - band[2]);
  }

  function windScore(profile, effective, windDir, ability, shoreFacing) {
    if (!finite(effective)) return null;
    var words = windWords(windDir, shoreFacing);
    var o = words.onshoreness == null ? 0.5 : words.onshoreness;
    var chop = effective * (0.25 + 0.75 * o);
    var score = 10 - profile.windRate * Math.max(0, chop);
    if (o < 0.25) {
      if (ability === "beginner" && effective > 12) score -= 0.5 * (effective - 12);
      if (ability !== "beginner" && effective > 20) score -= 0.4 * (effective - 20);
    }
    return { score: clamp(score, 0, 10), chop: chop, onshoreness: o, label: words.label };
  }

  function powerScore(faceFt, periodS) {
    var period = finite(periodS) ? periodS : 8;
    var face = finite(faceFt) ? faceFt : 0;
    return clamp(10 - (face * face * period - 60) / 12, 0, 10);
  }

  function tideMult(tide, ability) {
    if (!tide || !finite(tide.stage)) return 1;
    var stage = tide.stage;
    if (stage >= 0.25 && stage <= 0.75) return 1;
    if (stage < 0.25) return ability === "advanced" ? 0.92 : 0.95;
    return ability === "beginner" ? 0.85 : 0.92;
  }

  function tideStage(hilo, t) {
    if (!hilo || hilo.length < 2 || !finite(t)) return null;
    for (var i = 0; i < hilo.length - 1; i++) {
      var a = hilo[i];
      var b = hilo[i + 1];
      if (t < a.t || t > b.t) continue;
      var span = b.t - a.t;
      var f = span ? (t - a.t) / span : 0;
      var height = a.v + (b.v - a.v) * (1 - Math.cos(Math.PI * f)) / 2;
      var lo = Math.min(a.v, b.v);
      var hi = Math.max(a.v, b.v);
      return {
        stage: (height - lo) / (hi - lo || 1),
        rising: b.type === "H",
        ft: height
      };
    }
    return null;
  }

  /* A real swell/sea split has a wind-sea component. GFS often returns
     wind_wave_height 0 and swell height equal to the total. That is not a split. */
  function swellSplitKnown(waveFt, swellFt, windWaveFt) {
    if (!finite(waveFt) || waveFt <= 0) return false;
    if (!finite(windWaveFt) || windWaveFt <= 0.2) return false;
    if (!finite(swellFt)) return false;
    if (swellFt >= waveFt * 0.9 && windWaveFt < 0.5) return false;
    return true;
  }

  function modelSpread(feetValues) {
    var values = (feetValues || []).filter(function (n) { return finite(n) && n > 0; });
    if (!values.length) return { lowConfidence: false, min: null, max: null, spread: 0, count: 0 };
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var spread = values.length > 1 ? (max - min) / min : 0;
    return {
      lowConfidence: values.length > 1 && spread > 0.4,
      min: min,
      max: max,
      spread: spread,
      count: values.length
    };
  }

  function windCellMoved(spot, returned) {
    if (!spot || !returned || !finite(returned.lon)) return false;
    var inlandLon = finite(spot.inlandLon) ? spot.inlandLon : (spot.inland && finite(spot.inland.lon) ? spot.inland.lon : null);
    var beachLon = finite(spot.lon) ? spot.lon : (spot.beachLon);
    if (!finite(inlandLon) || !finite(beachLon)) return false;
    /* East of the known inland/lagoon cell by ~0.03°, and not west of the beach. */
    if (!(returned.lon > inlandLon + 0.03)) return false;
    if (!(returned.lon > beachLon - 0.01)) return false;
    return true;
  }

  function easternWall(date) {
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    var parts = {};
    fmt.formatToParts(date).forEach(function (part) { parts[part.type] = part.value; });
    var hour = +parts.hour;
    if (hour === 24) hour = 0;
    return { y: +parts.year, mo: +parts.month, d: +parts.day, h: hour, mi: +parts.minute };
  }

  function stamp(wall) {
    return Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h || 0, wall.mi || 0);
  }

  function wallToUtc(wall) {
    var guess = stamp(wall);
    var inv = easternWall(new Date(guess));
    return new Date(guess + (stamp(wall) - stamp(inv)));
  }

  function hoursAhead(wall, now) {
    if (!wall || !now) return 0;
    return (wallToUtc(wall).getTime() - wallToUtc(now).getTime()) / 36e5;
  }

  function sameDay(a, b) {
    return a && b && a.y === b.y && a.mo === b.mo && a.d === b.d;
  }

  function addDays(wall, days) {
    var shifted = new Date(Date.UTC(wall.y, wall.mo - 1, wall.d + days));
    return { y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), h: 0, mi: 0 };
  }

  function weekdayIndex(wall) {
    return new Date(Date.UTC(wall.y, wall.mo - 1, wall.d)).getUTCDay();
  }

  /* Daylight only. For today, keep the current hour and later hours. */
  function isDaylightHour(wall, now) {
    if (!wall || wall.h == null || wall.h < DAYLIGHT_START || wall.h > DAYLIGHT_END) return false;
    if (now && sameDay(wall, now) && wall.h < now.h) return false;
    return true;
  }

  function peakDaytimeWave(samples, now) {
    var best = null;
    (samples || []).forEach(function (sample) {
      if (!sample || !isDaylightHour(sample.wall, now) || !finite(sample.height)) return;
      if (!best || sample.height > best.height) best = sample;
    });
    return best;
  }

  function blankScore(extra) {
    return Object.assign({
      score: null,
      verdict: "No estimate",
      banner: null,
      noEstimate: true,
      reason: null,
      breakingFt: null,
      setsFt: null,
      uncapped: null,
      parts: null,
      tideMult: 1,
      notes: [],
      caps: {},
      level: null,
      gentle: false
    }, extra || {});
  }

  function tropicalBanner() {
    return "Tropical or hurricane swell. Check the National Weather Service before going out. This page is not scoring it.";
  }

  function isTropicalInput(inp) {
    if (!inp) return false;
    if (inp.tropical === true) return true;
    var text = inp.hazardText || "";
    return /hurricane|tropical storm|tropical cyclone/i.test(text);
  }

  function hazardsLoaded(inp) {
    if (!inp || inp.hazardsLoaded === false) return false;
    if (inp.hazardsLoaded === true) return true;
    return inp.ripRisk === "high" || inp.ripRisk === "moderate" || inp.ripRisk === "low";
  }

  function profileFor(ability, gentle) {
    var base = PROFILES[ability];
    if (ability === "beginner" && gentle) {
      return Object.assign({}, base, { size: GENTLE_SIZE.slice(), setsCap: GENTLE_SETS });
    }
    return base;
  }

  function beginnerVerdict(score, flags) {
    if (flags.ripHigh) return "High rip current risk. Not for beginners today.";
    if (flags.sets) return "Too big for beginners.";
    if (flags.ripMod) return "Moderate rip current risk. Check the flags and stay near a lifeguard.";
    if (flags.offshore) return "Strong offshore wind. Hard to paddle back.";
    if (flags.horizon) return "Hazards aren't confirmed this far out. Check the National Weather Service before you decide.";
    if (flags.thunderWarning) return "Thunderstorm warning. Stay out of the water.";
    if (score >= 7) return "Check the flags and surf near a lifeguard.";
    if (score >= 5) return "Marginal for beginners. Check the flags first.";
    if (score >= 3) return "Not a comfortable beginner session.";
    return "Stay out of the water.";
  }

  function otherVerdict(score, ability, flags) {
    var line;
    if (flags.thunderWarning) line = "Thunderstorm warning. Stay out of the water.";
    else if (score >= 8) line = "Favorable for this level.";
    else if (score >= 6) line = "Worth a look for this level.";
    else if (score >= 4) line = "Marginal for this level.";
    else if (ability === "advanced") line = "Too small to be worth the paddle.";
    else line = "Unfavorable for this level.";
    if (flags.ripHigh) return line + " High rip current risk is in effect.";
    if (flags.ripMod) return line + " Moderate rip current risk is in effect.";
    return line;
  }

  function scoreAbility(inp, ability, options) {
    var level = LEVELS.indexOf(ability) === -1 ? "beginner" : ability;
    var opt = options || {};
    var gentle = level === "beginner" && !!(opt.gentle || (inp && inp.gentle));
    var input = inp || {};

    if (isTropicalInput(input)) {
      return blankScore({
        reason: "tropical",
        banner: tropicalBanner(),
        level: level,
        gentle: gentle,
        notes: [tropicalBanner()]
      });
    }

    if (!hazardsLoaded(input) && level === "beginner") {
      return blankScore({
        reason: "hazards-unconfirmed",
        level: level,
        gentle: gentle,
        notes: ["Rip risk isn't confirmed, so there's no beginner score."]
      });
    }

    var hs = finite(input.hsFt) ? input.hsFt : null;
    var period = finite(input.periodS) && input.periodS > 0 ? input.periodS : null;
    if (hs == null) {
      return blankScore({ reason: "missing-wave", level: level, gentle: gentle, notes: ["Wave height is missing."] });
    }
    if (period == null) {
      return blankScore({ reason: "missing-period", level: level, gentle: gentle, notes: ["Wave period is missing."] });
    }

    var effective = effectiveWindMph(input.windMph, input.gustMph);
    if (effective == null) {
      return blankScore({ reason: "missing-wind", level: level, gentle: gentle, notes: ["Wind is missing."] });
    }

    var shore = finite(input.shoreFacing) ? input.shoreFacing : SHORE_FACING.satellite;
    var face = breakingFt(hs, period, finite(input.swellDir) ? input.swellDir : null, shore);
    var sets = face * 1.3;
    var profile = profileFor(level, gentle);
    var wind = windScore(profile, effective, finite(input.windDir) ? input.windDir : null, level, shore);
    var parts = {
      size: trap(face, profile.size),
      period: trap(period, profile.period),
      wind: wind.score,
      chop: wind.chop,
      onshoreness: wind.onshoreness,
      windLabel: wind.label,
      effectiveWind: effective
    };
    if (profile.weights.power) parts.power = powerScore(face, period);

    var gate = parts.size / 10;
    Object.keys(profile.weights).forEach(function (key) {
      gate *= Math.pow(Math.max(parts[key], 0.01) / 10, profile.weights[key]);
    });
    var tideFactor = tideMult(input.tide, level);
    var uncapped = 10 * gate * tideFactor;

    var rip = input.ripRisk || null;
    var splitKnown = input.swellSplitKnown === true;
    var ahead = finite(input.hoursAhead) ? input.hoursAhead : 0;
    var hazardsUnknown = input.hazardsKnown === false || (ahead > HAZARD_HORIZON_HOURS && input.hazardsKnown !== true);
    var flags = {
      sets: false,
      ripHigh: rip === "high",
      ripMod: rip === "moderate",
      offshore: wind.onshoreness != null && wind.onshoreness < 0.25 && effective >= OFFSHORE_BEGINNER_MPH,
      split: level === "intermediate" && !splitKnown,
      horizon: level === "beginner" && hazardsUnknown,
      thunderWarning: input.thunderWarning === true
    };

    var raw = uncapped;
    var caps = { ripBound: false, setsBound: false, offshoreBound: false, splitBound: false, horizonBound: false, thunderBound: false };

    if (level === "beginner" && sets > profile.setsCap) {
      flags.sets = true;
      var beforeSets = raw;
      raw = Math.min(raw, 3);
      caps.setsBound = raw < beforeSets - 1e-9;
    }
    if (level === "beginner" && rip === "high") {
      var beforeHigh = raw;
      raw = Math.min(raw, 3);
      caps.ripBound = raw < beforeHigh - 1e-9;
    }
    if (level === "beginner" && rip === "moderate") {
      var beforeMod = raw;
      raw = Math.min(raw, 6);
      caps.ripBound = caps.ripBound || raw < beforeMod - 1e-9;
    }
    if (level === "beginner" && flags.offshore) {
      var beforeOff = raw;
      raw = Math.min(raw, OFFSHORE_BEGINNER_CAP);
      caps.offshoreBound = raw < beforeOff - 1e-9;
    }
    if (flags.split) {
      var beforeSplit = raw;
      raw = Math.min(raw, INTERMEDIATE_UNKNOWN_SPLIT_CAP);
      caps.splitBound = raw < beforeSplit - 1e-9;
    }
    if (level === "intermediate" && (rip === "high" || rip === "moderate")) {
      raw -= 1;
      caps.ripBound = true;
    }
    if (flags.horizon) {
      var beforeHorizon = raw;
      raw = Math.min(raw, 6);
      caps.horizonBound = raw < beforeHorizon - 1e-9;
    }
    if (flags.thunderWarning) {
      var beforeThunder = raw;
      raw = Math.min(raw, 1);
      caps.thunderBound = raw < beforeThunder - 1e-9;
    }

    raw = clamp(raw, 0, 10);
    var score = Math.round(raw);
    var verdict = level === "beginner" ? beginnerVerdict(score, flags) : otherVerdict(score, level, flags);
    var notes = [];
    notes.push("Size: model face about " + face.toFixed(1) + " ft, sets about " + sets.toFixed(1) + " ft.");
    notes.push("Period: " + period.toFixed(1) + " s.");
    notes.push("Wind: " + effective.toFixed(0) + " mph effective, " + wind.label + ".");
    if (parts.power != null) notes.push("Power: " + parts.power.toFixed(1) + " out of 10.");
    if (input.tide && finite(input.tide.stage)) {
      notes.push("Tide preference is low confidence.");
    } else {
      notes.push("Tide was not used. Tide preference is low confidence.");
    }
    if (!splitKnown) notes.push("Swell and wind sea are not separated in this model.");
    if (flags.split) notes.push("Intermediate scores stop at 8 until the swell is separated from the wind sea.");
    if (level === "intermediate" && (flags.ripHigh || flags.ripMod)) notes.push("Rip risk subtracts 1.");
    if (flags.sets) notes.push("Sets are too big for beginners.");
    if (flags.offshore && level === "beginner") notes.push("Strong offshore wind makes it hard to paddle back.");
    if (flags.horizon) notes.push("Hazards are not confirmed this far out.");
    if (flags.ripHigh && level === "beginner") notes.push("High rip current risk caps the beginner score at 3.");
    if (flags.ripMod && level === "beginner") notes.push("Moderate rip current risk caps the beginner score at 6.");
    if (gentle) notes.push("Gentle mode is on: a tighter range for smaller surf.");

    return {
      score: score,
      verdict: verdict,
      banner: null,
      noEstimate: false,
      reason: null,
      breakingFt: face,
      setsFt: sets,
      uncapped: uncapped,
      parts: parts,
      tideMult: tideFactor,
      notes: notes,
      caps: caps,
      flags: flags,
      level: level,
      gentle: gentle,
      ripRisk: rip
    };
  }

  /* NWS surf-zone headers abbreviate later zones: FLZ154-647-747-212100-
     means FLZ154, FLZ647, and FLZ747. The literal "FLZ747" is not in that line. */
  function zonesInHeader(chunk) {
    var zones = [];
    String(chunk || "").split(/\n/).slice(0, 8).forEach(function (line) {
      var trimmed = line.trim();
      if (!/^[A-Z]{3}\d{3}(-[A-Z0-9]+)*-?$/.test(trimmed)) return;
      var bits = trimmed.replace(/-$/, "").split("-");
      if (bits.length && /^\d{6}$/.test(bits[bits.length - 1])) bits.pop();
      var prefix = bits[0].slice(0, 3);
      bits.forEach(function (bit, index) {
        if (index === 0) zones.push(bit);
        else if (/^\d{3}$/.test(bit)) zones.push(prefix + bit);
      });
    });
    return zones;
  }

  function extractZone(text, zone) {
    var parts = String(text || "").split(/\n\$\$\s*/);
    for (var i = 0; i < parts.length; i++) {
      if (zonesInHeader(parts[i]).indexOf(zone) !== -1) return parts[i];
    }
    return "";
  }

  function periodDate(label, issued) {
    var name = String(label || "").toUpperCase();
    if (name.indexOf("TODAY") !== -1) return { y: issued.y, mo: issued.mo, d: issued.d };
    for (var i = 0; i < WEEKDAYS.length; i++) {
      if (name.indexOf(WEEKDAYS[i].toUpperCase()) === -1) continue;
      var issuedDow = weekdayIndex(issued);
      var delta = (i - issuedDow + 7) % 7;
      return addDays(issued, delta);
    }
    return null;
  }

  function parsePeriodBlock(label, body, issued) {
    var ripMatch = /Rip Current Risk\**\s*\.*\s*(High|Moderate|Low)/i.exec(body);
    var surfMatch = /Surf Height\s*\.*\s*(?:Around\s+)?(\d+)(?:\s+to\s+(\d+))?\s+feet/i.exec(body);
    var thunderMatch = /Thunderstorm Potential\**\s*\.*\s*([A-Za-z]+)/i.exec(body);
    var thunderWord = thunderMatch ? thunderMatch[1] : "";
    var surf = null;
    if (surfMatch) {
      var low = +surfMatch[1];
      var high = surfMatch[2] ? +surfMatch[2] : low;
      surf = { low: Math.min(low, high), high: Math.max(low, high) };
    }
    return {
      label: label,
      date: periodDate(label, issued),
      rip: ripMatch ? ripMatch[1].toLowerCase() : null,
      surf: surf,
      thunder: !!thunderWord && !/^none$/i.test(thunderWord)
    };
  }

  function parseSurfZone(text, options) {
    var opt = options || {};
    var zone = opt.zone || HAZARD_ZONE;
    var issued = opt.issued || easternWall(new Date());
    var section = extractZone(text, zone);
    var preamble = String(text || "").split(/\n\$\$\s*/)[0] || "";
    var tropical = /hurricane|tropical storm|tropical cyclone/i.test(section + "\n" + preamble);
    var periods = [];
    if (section) {
      var re = /^\.([A-Z][A-Z0-9 /'-]+)\.\.\./gm;
      var marks = [];
      var match;
      while ((match = re.exec(section))) {
        marks.push({ label: match[1].trim(), index: match.index, end: match.index + match[0].length });
      }
      for (var i = 0; i < marks.length; i++) {
        var stop = i + 1 < marks.length ? marks[i + 1].index : section.length;
        periods.push(parsePeriodBlock(marks[i].label, section.slice(marks[i].end, stop), issued));
      }
    }
    return { zone: zone, issued: issued, periods: periods, tropical: tropical, found: !!section };
  }

  function severity(risk) {
    if (risk === "high") return 3;
    if (risk === "moderate") return 2;
    if (risk === "low") return 1;
    return 0;
  }

  function worseRisk(a, b) {
    return severity(a) >= severity(b) ? a : b;
  }

  function parseAlerts(collection) {
    var features = collection && collection.features ? collection.features : [];
    var rip = null;
    var surfAdvisory = null;
    var tropical = false;
    var thunderWarning = false;
    features.forEach(function (feature) {
      var props = (feature && feature.properties) || {};
      var eventName = props.event || "";
      var headlines = props.parameters && props.parameters.NWSheadline ? props.parameters.NWSheadline.join(" ") : "";
      var blob = (eventName + " " + (props.headline || "") + " " + (props.description || "") + " " + headlines).toLowerCase();
      if (/hurricane|tropical storm|tropical cyclone/.test(blob)) tropical = true;
      if (/thunderstorm warning/.test(eventName.toLowerCase())) thunderWarning = true;
      if (/rip current/.test(eventName.toLowerCase())) {
        var risk = "high";
        if (/moderate/.test(blob) && !/high/.test(blob)) risk = "moderate";
        rip = {
          risk: risk,
          ends: props.ends || props.expires || null,
          headline: (props.parameters && props.parameters.NWSheadline && props.parameters.NWSheadline[0]) || props.headline || eventName
        };
      }
      if (/high surf|surf advisory|beach hazards/.test(eventName.toLowerCase())) {
        surfAdvisory = { event: eventName, headline: props.headline || eventName };
      }
    });
    return { rip: rip, surfAdvisory: surfAdvisory, tropical: tropical, thunderWarning: thunderWarning };
  }

  function alertCovers(rip, wall) {
    if (!rip || !rip.ends || !wall) return false;
    var end = new Date(rip.ends);
    if (isNaN(end.getTime())) return false;
    return wallToUtc(wall).getTime() <= end.getTime();
  }

  function periodFor(parsed, wall) {
    if (!parsed || !wall) return null;
    var found = null;
    (parsed.periods || []).forEach(function (period) {
      if (period.date && sameDay(period.date, wall)) found = period;
    });
    return found;
  }

  function resolveHazard(ctx) {
    var context = ctx || {};
    var parsed = context.parsed || null;
    var alerts = parseAlerts(context.alerts);
    var wall = context.wall;
    var now = context.now || wall;
    var textOk = !!(parsed && parsed.found);
    /* Beginner scores need a confirmed rip level. An empty alert list is not
       enough: Moderate often exists only in the surf-zone text. A covering
       Rip Current Statement is enough on its own, because that product is High. */
    var period = periodFor(parsed, wall);
    var fromText = period ? period.rip : null;
    var fromAlert = alerts.rip && wall && alertCovers(alerts.rip, wall) ? alerts.rip.risk : null;
    var loaded = context.fetchFailed ? false : textOk || !!fromAlert;
    if (context.loaded === false) loaded = false;
    var rip = worseRisk(fromAlert, fromText);
    if (!rip) rip = null;
    var ahead = wall && now ? hoursAhead(wall, now) : 0;
    var explicit = !!(fromAlert || fromText);
    var known = loaded && (explicit || ahead <= HAZARD_HORIZON_HOURS);
    if (loaded && textOk && ahead <= HAZARD_HORIZON_HOURS && !rip) rip = "low";
    if (!explicit && ahead > HAZARD_HORIZON_HOURS) {
      known = false;
      rip = null;
    }
    if (!loaded) {
      known = false;
      rip = null;
    }
    var tropical = !!(alerts.tropical || (parsed && parsed.tropical));
    return {
      loaded: !!loaded,
      ripRisk: rip,
      hazardsKnown: !!known,
      hoursAhead: ahead,
      tropical: tropical,
      surfAdvisory: !!alerts.surfAdvisory,
      surfAdvisoryText: alerts.surfAdvisory ? alerts.surfAdvisory.headline : "",
      thunder: !!(period && period.thunder),
      thunderWarning: alerts.thunderWarning,
      nwsSurf: period && period.surf ? period.surf : null,
      until: alerts.rip ? alerts.rip.ends : null,
      headline: alerts.rip ? alerts.rip.headline : "",
      zone: HAZARD_ZONE
    };
  }

  function formatWhen(iso) {
    if (!iso) return "";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    var wall = easternWall(date);
    var hour = wall.h % 12 || 12;
    var suffix = wall.h < 12 ? "AM" : "PM";
    var minute = String(wall.mi).padStart(2, "0");
    return WEEKDAYS[weekdayIndex(wall)].slice(0, 3) + " " + hour + ":" + minute + " " + suffix + " ET";
  }

  function safetyCopy(hazard) {
    if (!hazard) return { show: false, text: "", href: "https://www.weather.gov/mlb/" };
    var href = "https://www.weather.gov/mlb/";
    if (hazard.tropical) {
      return { show: true, text: tropicalBanner(), href: href, tone: "tropical" };
    }
    var bits = [];
    if (hazard.ripRisk === "high") {
      var until = formatWhen(hazard.until);
      bits.push(until
        ? "High rip current risk for Southern Brevard barrier islands (NWS zone FLZ747) through " + until + "."
        : "High rip current risk for Southern Brevard barrier islands (NWS zone FLZ747).");
    } else if (hazard.ripRisk === "moderate") {
      bits.push("Moderate rip current risk in the NWS Melbourne surf zone forecast for zone FLZ747.");
    }
    if (hazard.surfAdvisory) bits.push(hazard.surfAdvisoryText || "A surf advisory is in effect.");
    if (hazard.thunderWarning) bits.push("A thunderstorm warning is in effect. Stay out of the water.");
    else if (hazard.thunder && bits.length) bits.push("The surf zone forecast also notes thunderstorm potential.");
    if (!hazard.loaded) {
      return {
        show: true,
        text: "Rip risk could not be confirmed from the National Weather Service. Beginner scores stay hidden.",
        href: href,
        tone: "unknown"
      };
    }
    if (!bits.length) return { show: false, text: "", href: href };
    bits.push("Check the flags and the lifeguards.");
    return { show: true, text: bits.join(" "), href: href, tone: hazard.ripRisk || "advisory" };
  }

  return {
    SHORE_FACING: SHORE_FACING,
    HAZARD_ZONE: HAZARD_ZONE,
    WIND_POINTS: WIND_POINTS,
    PROFILES: PROFILES,
    DAYLIGHT_START: DAYLIGHT_START,
    DAYLIGHT_END: DAYLIGHT_END,
    scoreAbility: scoreAbility,
    breakingFt: breakingFt,
    shoalFactor: shoalFactor,
    onshoreness: onshoreness,
    windWords: windWords,
    effectiveWindMph: effectiveWindMph,
    tideStage: tideStage,
    tideMult: tideMult,
    swellSplitKnown: swellSplitKnown,
    modelSpread: modelSpread,
    windCellMoved: windCellMoved,
    isDaylightHour: isDaylightHour,
    peakDaytimeWave: peakDaytimeWave,
    hoursAhead: hoursAhead,
    easternWall: easternWall,
    parseSurfZone: parseSurfZone,
    parseAlerts: parseAlerts,
    resolveHazard: resolveHazard,
    safetyCopy: safetyCopy,
    formatWhen: formatWhen
  };
});
