/* Live conditions widget. Scoring lives in scoring/surf-score.js. */
(function () {
  "use strict";

  var S = window.SurfScore;
  var statusEl = document.getElementById("conditions-status");
  var rootEl = document.getElementById("conditions-root");
  var tideEl = document.getElementById("tide-line");
  var safetyEl = document.getElementById("conditions-safety");
  if (!statusEl || !rootEl) return;
  if (!S) {
    statusEl.textContent = "The score module did not load.";
    statusEl.classList.add("is-error");
    statusEl.setAttribute("aria-busy", "false");
    return;
  }

  var windPoints = S.WIND_POINTS;
  var SPOTS = [
    spot("satellite", "Satellite Beach", 28.1944, -80.5944, windPoints.satellite),
    spot("cocoa", "Cocoa Beach", 28.3678, -80.6018, windPoints.cocoa),
    spot("melbourne", "Melbourne Beach", 28.0684, -80.5570, windPoints.melbourne)
  ];

  function spot(id, name, lat, lon, wind) {
    return {
      id: id,
      name: name,
      lat: lat,
      lon: lon,
      shoreFacing: S.SHORE_FACING[id],
      windLat: wind.lat,
      windLon: wind.lon,
      windLonFallback: wind.fallbackLon,
      inlandLon: wind.inlandLon
    };
  }

  var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var KNOTS_TO_MPH = 1.15078;
  var PIER_MAX_AGE_MS = 3 * 60 * 60 * 1000;

  var state = {
    ready: false,
    level: "beginner",
    gentle: false,
    today: null,
    marines: [],
    winds: [],
    waters: [],
    spreads: [],
    tideSeries: [],
    pier: null,
    parsed: null,
    alerts: null,
    hazardsFailed: true
  };

  function num(value) {
    var n = typeof value === "number" ? value : parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeDeg(deg) {
    return ((deg % 360) + 360) % 360;
  }

  function compassLabel(deg) {
    return COMPASS[Math.round(normalizeDeg(deg) / 22.5) % 16];
  }

  function roundedMph(mph) {
    return Math.round(mph);
  }

  function roundedDeg(deg) {
    return Math.round(normalizeDeg(deg)) % 360;
  }

  function tenths(value) {
    return Math.round(value * 10) / 10;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function na() {
    var node = el("span", null, "n/a");
    node.setAttribute("aria-label", "Not available");
    return node;
  }

  function parseWall(iso) {
    var match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso || "");
    if (!match) return null;
    return {
      y: +match[1],
      mo: +match[2],
      d: +match[3],
      h: +match[4],
      mi: +match[5],
      key: match[1] + "-" + match[2] + "-" + match[3] + "T" + match[4] + ":" + match[5]
    };
  }

  function weekdayIndex(wall) {
    return new Date(Date.UTC(wall.y, wall.mo - 1, wall.d)).getUTCDay();
  }

  function stamp(wall) {
    return Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h || 0, wall.mi || 0);
  }

  function addDays(wall, days) {
    var shifted = new Date(Date.UTC(wall.y, wall.mo - 1, wall.d + days));
    return { y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), h: 0, mi: 0 };
  }

  function ymdCompact(wall) {
    return String(wall.y) + String(wall.mo).padStart(2, "0") + String(wall.d).padStart(2, "0");
  }

  function formatWall(wall) {
    var hour = wall.h % 12 || 12;
    var suffix = wall.h < 12 ? "AM" : "PM";
    var minute = String(wall.mi).padStart(2, "0");
    return WEEKDAYS[weekdayIndex(wall)] + ", " + MONTHS[wall.mo - 1] + " " + wall.d + ", " + hour + ":" + minute + " " + suffix + " ET";
  }

  function formatHour(wall, withDay) {
    var hour = wall.h % 12 || 12;
    var suffix = wall.h < 12 ? "AM" : "PM";
    var time = hour + " " + suffix;
    if (!withDay) return time;
    return WEEKDAYS[weekdayIndex(wall)] + " " + time;
  }

  function formatDay(wall, today) {
    var label = WEEKDAYS[weekdayIndex(wall)] + ", " + MONTHS[wall.mo - 1] + " " + wall.d;
    if (today && wall.y === today.y && wall.mo === today.mo && wall.d === today.d) return label + " (today)";
    return label;
  }

  function toFeet(value, unit) {
    var n = num(value);
    if (n == null) return null;
    var u = String(unit || "").toLowerCase();
    if (u === "ft" || u.indexOf("foot") !== -1 || u.indexOf("feet") !== -1) return n;
    if (u === "m" || u.indexOf("meter") !== -1 || u.indexOf("metre") !== -1) return n * 3.280839895;
    return null;
  }

  function toSeconds(value, unit) {
    var n = num(value);
    if (n == null || n <= 0) return null;
    var u = String(unit || "s").toLowerCase();
    if (u === "s" || u.indexOf("sec") === 0) return n;
    return null;
  }

  function toDegrees(value, unit) {
    var n = num(value);
    if (n == null) return null;
    var u = String(unit || "°").toLowerCase();
    if (u.indexOf("°") !== -1 || u.indexOf("deg") !== -1 || u === "") return normalizeDeg(n);
    return null;
  }

  function toMph(value, unit) {
    var n = num(value);
    if (n == null) return null;
    var u = String(unit || "").toLowerCase();
    if (u.indexOf("mp/h") !== -1 || u === "mph") return n;
    if (u === "km/h" || u === "kmh") return n / 1.609344;
    if (u === "m/s" || u === "ms") return n * 2.236936;
    if (u === "kn" || u.indexOf("knot") !== -1) return n * KNOTS_TO_MPH;
    return null;
  }

  function waterFahrenheit(value, unit) {
    var n = num(value);
    if (n == null) return null;
    var u = String(unit || "").toLowerCase();
    if (u.indexOf("c") !== -1) return n * 9 / 5 + 32;
    if (u.indexOf("f") !== -1) return n;
    return null;
  }

  function formatFeet(feet) {
    return feet == null ? null : tenths(feet).toFixed(1) + " ft";
  }

  function formatSeconds(seconds) {
    return seconds == null ? null : tenths(seconds).toFixed(1) + " s";
  }

  function locationList(data) {
    if (Array.isArray(data)) return data;
    if (data && data.latitude != null && !data.error) return [data];
    return null;
  }

  function unitsOf(block) {
    return (block && (block.current_units || block.hourly_units)) || {};
  }

  function hourMap(times, values, convert) {
    var map = {};
    if (!times || !values) return map;
    for (var i = 0; i < times.length; i++) {
      var wall = parseWall(times[i]);
      if (!wall) continue;
      map[wall.key] = convert(values[i]);
    }
    return map;
  }

  function buildMarine(block) {
    var units = unitsOf(block);
    var hourly = block.hourly || {};
    var current = block.current || {};
    var currentWall = parseWall(current.time);
    var waves = hourMap(hourly.time, hourly.wave_height, function (v) { return toFeet(v, units.wave_height); });
    var swellHeights = hourMap(hourly.time, hourly.swell_wave_height, function (v) { return toFeet(v, units.swell_wave_height); });
    var windWaves = hourMap(hourly.time, hourly.wind_wave_height, function (v) { return toFeet(v, units.wind_wave_height); });
    var swellPeriods = hourMap(hourly.time, hourly.swell_wave_period, function (v) { return toSeconds(v, units.swell_wave_period); });
    var wavePeriods = hourMap(hourly.time, hourly.wave_period, function (v) { return toSeconds(v, units.wave_period); });
    var swellDirs = hourMap(hourly.time, hourly.swell_wave_direction, function (v) { return toDegrees(v, units.swell_wave_direction); });
    function pick(field, convert, map) {
      var direct = convert(current[field], units[field]);
      if (direct != null) return direct;
      if (currentWall && map && map[currentWall.key] != null) return map[currentWall.key];
      return null;
    }
    return {
      time: currentWall,
      waveFt: pick("wave_height", toFeet, waves),
      swellFt: pick("swell_wave_height", toFeet, swellHeights),
      windWaveFt: pick("wind_wave_height", toFeet, windWaves),
      swellPeriod: pick("swell_wave_period", toSeconds, swellPeriods),
      wavePeriod: pick("wave_period", toSeconds, wavePeriods),
      swellDir: pick("swell_wave_direction", toDegrees, swellDirs),
      times: (hourly.time || []).map(parseWall).filter(Boolean),
      waves: waves,
      swellHeights: swellHeights,
      windWaves: windWaves,
      swellPeriods: swellPeriods,
      wavePeriods: wavePeriods,
      swellDirs: swellDirs
    };
  }

  function buildWind(block) {
    if (!block) return null;
    var units = unitsOf(block);
    var hourly = block.hourly || {};
    var current = block.current || {};
    var speeds = hourMap(hourly.time, hourly.wind_speed_10m, function (v) { return toMph(v, units.wind_speed_10m); });
    var dirs = hourMap(hourly.time, hourly.wind_direction_10m, function (v) { return toDegrees(v, units.wind_direction_10m); });
    var gusts = hourMap(hourly.time, hourly.wind_gusts_10m, function (v) { return toMph(v, units.wind_gusts_10m); });
    var currentWall = parseWall(current.time);
    var speed = toMph(current.wind_speed_10m, units.wind_speed_10m);
    var dir = toDegrees(current.wind_direction_10m, units.wind_direction_10m);
    var gust = toMph(current.wind_gusts_10m, units.wind_gusts_10m);
    if (currentWall) {
      if (speed == null) speed = speeds[currentWall.key];
      if (dir == null) dir = dirs[currentWall.key];
      if (gust == null) gust = gusts[currentWall.key];
    }
    return {
      time: currentWall,
      speed: speed,
      dir: dir,
      gust: gust,
      speeds: speeds,
      dirs: dirs,
      gusts: gusts,
      cell: finiteLatLon(block) ? { lat: block.latitude, lon: block.longitude } : null,
      source: "model"
    };
  }

  function finiteLatLon(block) {
    return block && Number.isFinite(block.latitude) && Number.isFinite(block.longitude);
  }

  function periodAt(marine, key) {
    if (!marine) return null;
    if (marine.swellPeriods[key] != null) return marine.swellPeriods[key];
    return marine.wavePeriods[key] != null ? marine.wavePeriods[key] : null;
  }

  function currentPeriod(marine) {
    if (!marine) return null;
    if (marine.swellPeriod != null) return marine.swellPeriod;
    return marine.wavePeriod;
  }

  function levelName(level) {
    if (level === "intermediate") return "Intermediate";
    if (level === "advanced") return "Advanced";
    return "Beginner";
  }

  function readStoredLevel() {
    try {
      var value = localStorage.getItem("sbsg.ability");
      if (value === "intermediate" || value === "advanced" || value === "beginner") return value;
    } catch (error) { /* private mode */ }
    return "beginner";
  }

  function readStoredGentle() {
    try { return localStorage.getItem("sbsg.gentle") === "1"; } catch (error) { return false; }
  }

  function saveLevel(level, gentle) {
    try {
      localStorage.setItem("sbsg.ability", level);
      localStorage.setItem("sbsg.gentle", gentle ? "1" : "0");
    } catch (error) { /* private mode */ }
  }

  function bindLevel() {
    state.level = readStoredLevel();
    state.gentle = readStoredGentle();
    var radios = document.querySelectorAll('input[name="sbsg-level"]');
    Array.prototype.forEach.call(radios, function (radio) {
      radio.checked = radio.value === state.level;
      radio.addEventListener("change", function () {
        if (!radio.checked) return;
        state.level = radio.value;
        saveLevel(state.level, state.gentle);
        updateGentleHelp();
        if (state.ready) render();
      });
    });
    var gentle = document.getElementById("gentle-mode");
    if (gentle) {
      gentle.checked = state.gentle;
      gentle.addEventListener("change", function () {
        state.gentle = gentle.checked;
        saveLevel(state.level, state.gentle);
        if (state.ready) render();
      });
    }
    updateGentleHelp();
  }

  function updateGentleHelp() {
    var help = document.getElementById("gentle-help");
    if (!help) return;
    help.textContent = state.level === "beginner"
      ? "Optional. Scores a tighter range for smaller surf."
      : "Optional. It changes the Beginner score only.";
  }

  function scoreAt(input, level) {
    return S.scoreAbility(input, level, { gentle: level === "beginner" && state.gentle });
  }

  function hazardAt(wall) {
    return S.resolveHazard({
      parsed: state.parsed,
      alerts: state.alerts,
      wall: wall,
      now: state.today
    });
  }

  function inputFromHour(spot, marine, wind, hour) {
    var key = hour.key;
    var wave = marine.waves[key];
    var swell = marine.swellHeights[key];
    var windWave = marine.windWaves[key];
    var hazard = hazardAt(hour);
    return {
      hsFt: wave,
      periodS: periodAt(marine, key),
      swellDir: marine.swellDirs[key],
      windMph: wind ? wind.speeds[key] : null,
      gustMph: wind && wind.gusts ? wind.gusts[key] : null,
      windDir: wind ? wind.dirs[key] : null,
      shoreFacing: spot.shoreFacing,
      tide: S.tideStage(state.tideSeries, stamp(hour)),
      ripRisk: hazard.ripRisk,
      hazardsLoaded: hazard.loaded,
      hazardsKnown: hazard.hazardsKnown,
      hoursAhead: hazard.hoursAhead,
      swellSplitKnown: S.swellSplitKnown(wave, swell, windWave),
      tropical: hazard.tropical,
      thunderWarning: hazard.thunderWarning
    };
  }

  function inputFromCurrent(spot, marine, wind) {
    var when = marine && marine.time ? marine.time : state.today;
    var hazard = hazardAt(when);
    var speed = wind ? wind.speed : null;
    var gust = wind ? wind.gust : null;
    var dir = wind ? wind.dir : null;
    if (state.pier && state.pier.fresh) {
      speed = state.pier.mph;
      gust = state.pier.gust;
      dir = state.pier.dir;
    }
    return {
      hsFt: marine ? marine.waveFt : null,
      periodS: currentPeriod(marine),
      swellDir: marine ? marine.swellDir : null,
      windMph: speed,
      gustMph: gust,
      windDir: dir,
      shoreFacing: spot.shoreFacing,
      tide: when ? S.tideStage(state.tideSeries, stamp(when)) : null,
      ripRisk: hazard.ripRisk,
      hazardsLoaded: hazard.loaded,
      hazardsKnown: hazard.hazardsKnown,
      hoursAhead: when ? hazard.hoursAhead : 0,
      swellSplitKnown: marine ? S.swellSplitKnown(marine.waveFt, marine.swellFt, marine.windWaveFt) : false,
      tropical: hazard.tropical,
      thunderWarning: hazard.thunderWarning,
      hazard: hazard
    };
  }

  function band(score) {
    if (score == null) return "none";
    if (score <= 2) return "low";
    if (score <= 4) return "mid";
    if (score <= 6) return "upper";
    return "top";
  }

  function whyChips(result) {
    if (!result || result.noEstimate) return [];
    var chips = [];
    var flags = result.flags || {};
    if (flags.ripHigh) {
      chips.push(result.caps && result.caps.ripBound
        ? (result.level === "beginner" ? "High rip cap" : "High rip, minus 1")
        : "High rip risk");
    }
    if (flags.ripMod) {
      chips.push(result.caps && result.caps.ripBound
        ? (result.level === "beginner" ? "Moderate rip cap" : "Moderate rip, minus 1")
        : "Moderate rip risk");
    }
    if (flags.offshore && result.level === "beginner") chips.push("Hard to paddle back");
    if (flags.sets) chips.push("Sets too big");
    if (flags.split) chips.push("Swell split unknown");
    if (flags.horizon) chips.push("Hazards not confirmed");
    if (result.breakingFt != null) chips.push("Face about " + result.breakingFt.toFixed(1) + " ft");
    return chips.slice(0, 4);
  }

  function renderScore(spot, result) {
    var block = el("div", "score-block");
    block.appendChild(el("p", "score-kicker", levelName(state.level) + (state.gentle && state.level === "beginner" ? " · gentle" : "")));
    var ring = el("div", "score-ring");
    var label = result && !result.noEstimate
      ? levelName(state.level) + " score " + result.score + " out of 10. " + result.verdict
      : levelName(state.level) + " score unavailable. " + ((result && result.verdict) || "No estimate");
    ring.setAttribute("role", "img");
    ring.setAttribute("aria-label", label);
    ring.dataset.band = band(result && result.score);
    ring.style.setProperty("--score", result && result.score != null ? String(result.score) : "0");
    var inner = el("div", "score-ring-inner");
    inner.setAttribute("aria-hidden", "true");
    inner.appendChild(el("span", "score-num", result && result.score != null ? String(result.score) : "–"));
    inner.appendChild(el("span", "score-denom", "/10"));
    ring.appendChild(inner);
    block.appendChild(ring);
    block.appendChild(el("p", "score-verdict", result ? result.verdict : "No estimate"));
    return block;
  }

  function renderCompare(input) {
    var list = el("ul", "level-compare");
    list.setAttribute("aria-label", "Score at each level");
    ["beginner", "intermediate", "advanced"].forEach(function (level) {
      var result = scoreAt(input, level);
      var item = el("li", level === state.level ? "is-selected" : "");
      item.appendChild(el("span", null, levelName(level)));
      var strong = el("strong", null, result.score == null ? "No estimate" : String(result.score));
      item.appendChild(strong);
      if (level === state.level) item.setAttribute("aria-current", "true");
      list.appendChild(item);
    });
    return list;
  }

  function renderWhy(result) {
    var chips = el("ul", "why-chips");
    whyChips(result).forEach(function (text) {
      chips.appendChild(el("li", null, text));
    });
    var details = el("details", "why");
    var summary = el("summary", null, "Why this score");
    details.appendChild(summary);
    if (!result) {
      details.appendChild(el("p", null, "No estimate."));
      return { chips: chips, details: details };
    }
    if (result.parts) {
      var rows = [
        ["Size", result.parts.size],
        ["Period", result.parts.period],
        ["Wind", result.parts.wind]
      ];
      if (result.parts.power != null) rows.push(["Power", result.parts.power]);
      rows.forEach(function (row) {
        var line = el("div", "why-row");
        line.appendChild(el("span", "why-name", row[0]));
        var meter = el("span", "why-meter");
        meter.appendChild(el("span", null));
        meter.firstChild.style.width = Math.max(0, Math.min(100, row[1] * 10)) + "%";
        line.appendChild(meter);
        line.appendChild(el("span", "why-value", Math.round(row[1]) + "/10"));
        details.appendChild(line);
      });
    }
    var list = el("ul", "why-notes");
    (result.notes || []).forEach(function (note) {
      list.appendChild(el("li", null, note));
    });
    details.appendChild(list);
    return { chips: chips, details: details };
  }

  function renderHazards(hazard) {
    var row = el("ul", "hazard-row");
    if (!hazard) return row;
    if (hazard.ripRisk === "high" || hazard.ripRisk === "moderate") {
      var item = el("li");
      var link = el("a", "hazard-chip", hazard.ripRisk === "high" ? "High rip current risk (NWS)" : "Moderate rip current risk (NWS)");
      link.href = "https://www.weather.gov/mlb/";
      item.appendChild(link);
      row.appendChild(item);
    }
    if (hazard.surfAdvisory) {
      row.appendChild(el("li", "hazard-chip hazard-chip-static", "Surf advisory (NWS)"));
    }
    if (hazard.thunderWarning) {
      row.appendChild(el("li", "hazard-chip hazard-chip-static", "Thunderstorm warning"));
    } else if (hazard.thunder) {
      row.appendChild(el("li", "hazard-chip hazard-chip-quiet", "Thunderstorms possible (NWS)"));
    }
    return row;
  }

  function windPhrase(mph, deg, shoreFacing) {
    if (mph == null) return null;
    var speed = roundedMph(mph);
    if (speed === 0) return { text: "Calm", aria: "Calm, 0 miles per hour", shortSpeed: "Calm", shortDir: "" };
    if (deg == null) return { text: speed + " mph", aria: speed + " miles per hour, direction not available", shortSpeed: speed + " mph", shortDir: "" };
    var direction = roundedDeg(deg);
    var point = compassLabel(direction);
    var words = S.windWords(direction, shoreFacing);
    var sector = words.label;
    return {
      text: speed + " mph from " + direction + "° " + point + ", " + sector,
      shortSpeed: speed + " mph",
      shortDir: direction + "° " + point,
      aria: speed + " miles per hour from " + direction + " degrees " + point + ", " + sector,
      sector: sector
    };
  }

  function appendStat(list, wide, label, valueNode) {
    var wrap = el("div", wide ? "wide" : "");
    wrap.appendChild(el("dt", null, label));
    var dd = el("dd");
    dd.appendChild(valueNode);
    wrap.appendChild(dd);
    list.appendChild(wrap);
  }

  function textOrNa(text) {
    return text == null ? na() : document.createTextNode(text);
  }

  function renderHourTable(spot, marine, wind) {
    if (!marine || !marine.time || !marine.times.length) return null;
    var startIndex = 0;
    for (var i = 0; i < marine.times.length; i++) {
      if (marine.times[i].key <= marine.time.key) startIndex = i;
      else break;
    }
    var hours = marine.times.slice(startIndex, startIndex + 12);
    if (!hours.length) return null;
    var scored = hours.map(function (hour) {
      return { hour: hour, result: scoreAt(inputFromHour(spot, marine, wind, hour), state.level) };
    });
    var best = null;
    scored.forEach(function (item) {
      if (item.result.score == null) return;
      if (!best || item.result.score > best.result.score) best = item;
    });

    var block = el("div");
    block.appendChild(el("p", "card-note", "Next 12 hours for the selected level. On a small screen, scroll sideways."));
    var scroller = el("div", "hour-scroll");
    scroller.tabIndex = 0;
    scroller.setAttribute("role", "region");
    scroller.setAttribute("aria-label", "Next 12 hours at " + spot.name);

    var table = document.createElement("table");
    table.appendChild(el("caption", "sr-only", "Wave height, period, wind, and score for the next 12 hours."));
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    var corner = el("th");
    corner.scope = "col";
    corner.appendChild(el("span", "sr-only", "Measurement"));
    headRow.appendChild(corner);
    hours.forEach(function (hour, index) {
      var previous = index > 0 ? hours[index - 1] : null;
      var withDay = index === 0 || !previous || previous.d !== hour.d || previous.mo !== hour.mo;
      var th = el("th", null, formatHour(hour, withDay));
      th.scope = "col";
      if (best && best.hour.key === hour.key) th.className = "is-best";
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    function addRow(label, fill) {
      var row = document.createElement("tr");
      var th = el("th", null, label);
      th.scope = "row";
      row.appendChild(th);
      hours.forEach(function (hour) {
        var cell = document.createElement("td");
        fill(cell, hour);
        row.appendChild(cell);
      });
      return row;
    }

    var tbody = document.createElement("tbody");
    tbody.appendChild(addRow("Wave", function (cell, hour) {
      cell.appendChild(textOrNa(formatFeet(marine.waves[hour.key])));
    }));
    tbody.appendChild(addRow("Period", function (cell, hour) {
      cell.appendChild(textOrNa(formatSeconds(periodAt(marine, hour.key))));
    }));
    tbody.appendChild(addRow("Wind", function (cell, hour) {
      if (!wind) {
        cell.appendChild(na());
        return;
      }
      var phrase = windPhrase(wind.speeds[hour.key], wind.dirs[hour.key], spot.shoreFacing);
      if (!phrase) {
        cell.appendChild(na());
        return;
      }
      var gust = wind.gusts ? wind.gusts[hour.key] : null;
      var aria = phrase.aria;
      if (gust != null && phrase.shortSpeed !== "Calm") aria += ", gusts " + roundedMph(gust) + " miles per hour";
      cell.setAttribute("aria-label", aria);
      cell.appendChild(el("span", "hour-wind", phrase.shortSpeed));
      if (gust != null && phrase.shortSpeed !== "Calm") cell.appendChild(el("span", "hour-dir", "gusts " + roundedMph(gust)));
      if (phrase.shortDir) cell.appendChild(el("span", "hour-dir", phrase.shortDir));
    }));
    tbody.appendChild(addRow("Score", function (cell, hour) {
      var found = null;
      scored.forEach(function (item) { if (item.hour.key === hour.key) found = item; });
      if (!found || found.result.score == null) {
        cell.textContent = "No estimate";
        return;
      }
      cell.textContent = String(found.result.score);
      cell.setAttribute("aria-label", levelName(state.level) + " " + found.result.score + " out of 10. " + found.result.verdict);
      if (best && best.hour.key === hour.key) cell.className = "is-best";
    }));
    table.appendChild(tbody);
    scroller.appendChild(table);
    block.appendChild(scroller);
    return block;
  }

  function daytimeWind(marine, wind, dayKey, now) {
    if (!wind) return null;
    var east = 0;
    var north = 0;
    var speedSum = 0;
    var count = 0;
    marine.times.forEach(function (hour) {
      if (hour.key.slice(0, 10) !== dayKey) return;
      if (!S.isDaylightHour(hour, now)) return;
      var speed = wind.speeds[hour.key];
      var dir = wind.dirs[hour.key];
      if (speed == null || dir == null) return;
      var radians = dir * Math.PI / 180;
      east += speed * Math.sin(radians);
      north += speed * Math.cos(radians);
      speedSum += speed;
      count += 1;
    });
    if (!count) return null;
    var degrees = Math.atan2(east, north) * 180 / Math.PI;
    if (degrees < 0) degrees += 360;
    return { speed: speedSum / count, dir: degrees };
  }

  function renderDayTable(spot, marine, wind, today) {
    if (!marine || !marine.times.length) return null;
    var days = [];
    var seen = {};
    marine.times.forEach(function (hour) {
      var dayKey = hour.key.slice(0, 10);
      if (seen[dayKey]) return;
      seen[dayKey] = true;
      days.push({ key: dayKey, wall: hour });
    });
    days = days.slice(0, 5);
    if (!days.length) return null;

    var block = el("div");
    block.appendChild(el("p", "card-note", "Daytime hours only, 7:00 a.m. through 6:00 p.m. ET. Today starts at the current hour, so overnight peaks are left out. Wind in this table is the sea-side model, not the pier observation. The score is the best daytime hour for the selected level."));
    var scroller = el("div", "day-scroll");
    scroller.tabIndex = 0;
    scroller.setAttribute("role", "region");
    scroller.setAttribute("aria-label", "Next 5 days at " + spot.name);

    var table = document.createElement("table");
    table.className = "day-table";
    table.appendChild(el("caption", "sr-only", "Daytime wave, period, model wind, and best score for the selected level."));
    var headRow = document.createElement("tr");
    ["Day", "Daytime max", "Period", "Wind (model)", "Best score"].forEach(function (label) {
      var th = el("th", null, label);
      th.scope = "col";
      headRow.appendChild(th);
    });
    var thead = document.createElement("thead");
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");

    days.forEach(function (day) {
      var samples = [];
      marine.times.forEach(function (hour) {
        if (hour.key.slice(0, 10) !== day.key) return;
        samples.push({ wall: hour, height: marine.waves[hour.key] });
      });
      var peak = S.peakDaytimeWave(samples, today);
      var period = peak ? periodAt(marine, peak.wall.key) : null;
      var windDay = daytimeWind(marine, wind, day.key, today);
      var best = null;
      marine.times.forEach(function (hour) {
        if (hour.key.slice(0, 10) !== day.key) return;
        if (!S.isDaylightHour(hour, today)) return;
        var result = scoreAt(inputFromHour(spot, marine, wind, hour), state.level);
        if (result.score == null) return;
        if (!best || result.score > best.result.score) best = { hour: hour, result: result };
      });

      var row = document.createElement("tr");
      var dayCell = el("th", null, formatDay(day.wall, today));
      dayCell.scope = "row";
      row.appendChild(dayCell);

      var waveCell = document.createElement("td");
      waveCell.appendChild(textOrNa(peak ? formatFeet(peak.height) : null));
      row.appendChild(waveCell);

      var periodCell = document.createElement("td");
      periodCell.appendChild(textOrNa(formatSeconds(period)));
      row.appendChild(periodCell);

      var windCell = document.createElement("td");
      var windText = windDay ? windPhrase(windDay.speed, windDay.dir, spot.shoreFacing) : null;
      if (!windText) windCell.appendChild(na());
      else {
        windCell.textContent = windText.shortSpeed === "Calm" ? "Calm" : (windText.shortSpeed + " " + windText.shortDir);
        windCell.setAttribute("aria-label", windText.aria);
      }
      row.appendChild(windCell);

      var scoreCell = document.createElement("td");
      if (!best) scoreCell.textContent = "No estimate";
      else {
        scoreCell.textContent = best.result.score + " · " + formatHour(best.hour, false);
        scoreCell.setAttribute("aria-label", levelName(state.level) + " " + best.result.score + " out of 10 at " + formatHour(best.hour, true) + ". " + best.result.verdict);
      }
      row.appendChild(scoreCell);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    scroller.appendChild(table);
    block.appendChild(scroller);
    return block;
  }

  function renderCard(spot, marine, wind, waterF, spread) {
    var card = el("article", "condition-card");
    card.setAttribute("aria-labelledby", spot.id + "-title");
    var input = inputFromCurrent(spot, marine, wind);
    var result = scoreAt(input, state.level);
    var hazard = input.hazard || hazardAt(state.today);

    var top = el("div", "card-top");
    var title = el("h3", null, spot.name);
    title.id = spot.id + "-title";
    top.appendChild(title);
    top.appendChild(renderScore(spot, result));
    card.appendChild(top);

    var hazardRow = renderHazards(hazard);
    if (hazardRow.childNodes.length) card.appendChild(hazardRow);

    if (!marine || marine.waveFt == null) {
      card.appendChild(el("p", "card-note", "No model wave data for this beach right now."));
      var whyEarly = renderWhy(result);
      if (whyEarly.chips.childNodes.length) card.appendChild(whyEarly.chips);
      card.appendChild(whyEarly.details);
      return card;
    }

    var hero = el("p", "wave-hero");
    hero.appendChild(document.createTextNode(tenths(marine.waveFt).toFixed(1)));
    hero.appendChild(el("span", null, "ft"));
    card.appendChild(hero);
    card.appendChild(el("p", "wave-label", "Offshore swell (model)"));

    if (spread && spread.lowConfidence) {
      var range = el("p", "model-note");
      range.appendChild(el("span", "confidence-tag", "Low confidence"));
      range.appendChild(document.createTextNode(" Models range " + spread.min.toFixed(1) + "–" + spread.max.toFixed(1) + " ft. The number above is GFS."));
      card.appendChild(range);
    }
    if (hazard.nwsSurf) {
      var surf = hazard.nwsSurf;
      var surfText = surf.low === surf.high ? "NWS surf about " + surf.low + " ft." : "NWS surf " + surf.low + "–" + surf.high + " ft.";
      card.appendChild(el("p", "model-note", surfText));
    }
    if (result.breakingFt != null) {
      card.appendChild(el("p", "model-note", "Model face about " + result.breakingFt.toFixed(1) + " ft, sets about " + result.setsFt.toFixed(1) + " ft."));
    }

    var splitKnown = S.swellSplitKnown(marine.waveFt, marine.swellFt, marine.windWaveFt);
    var list = el("dl", "metrics");
    if (splitKnown) {
      appendStat(list, false, "Swell height", textOrNa(formatFeet(marine.swellFt)));
      appendStat(list, false, "Wind sea", textOrNa(formatFeet(marine.windWaveFt)));
      appendStat(list, false, "Swell period", textOrNa(formatSeconds(currentPeriod(marine))));
      var splitDir = marine.swellDir == null ? null : roundedDeg(marine.swellDir) + "° " + compassLabel(marine.swellDir);
      appendStat(list, false, "Swell direction", textOrNa(splitDir));
    } else {
      appendStat(list, true, "Swell / wind sea", document.createTextNode("Not separated"));
      appendStat(list, false, "Wave period", textOrNa(formatSeconds(currentPeriod(marine))));
      var directionText = marine.swellDir == null ? null : roundedDeg(marine.swellDir) + "° " + compassLabel(marine.swellDir);
      appendStat(list, false, "Wave direction", textOrNa(directionText));
    }
    if (waterF != null) appendStat(list, false, "Water", document.createTextNode(Math.round(waterF) + "°F"));

    var windNode = document.createElement("span");
    var usingPier = !!(state.pier && state.pier.fresh);
    var shown = usingPier ? state.pier : wind;
    if (!shown || shown.mph == null && shown.speed == null) {
      windNode.textContent = "Not available";
    } else {
      var mph = usingPier ? shown.mph : shown.speed;
      var gust = usingPier ? shown.gust : shown.gust;
      var deg = usingPier ? shown.dir : shown.dir;
      var phrase = windPhrase(mph, deg, spot.shoreFacing);
      var windText = phrase ? phrase.text : "Not available";
      if (gust != null && phrase && roundedMph(mph) !== 0) windText += ". Gusts " + roundedMph(gust) + " mph.";
      if (usingPier) windText += " Trident Pier observation, " + formatWall(state.pier.wall) + ".";
      else if (wind && wind.cell) windText += " Open-Meteo sea cell " + wind.cell.lat.toFixed(3) + ", " + wind.cell.lon.toFixed(3) + ".";
      windNode.textContent = windText;
    }
    appendStat(list, true, "Wind", windNode);
    card.appendChild(list);
    card.appendChild(renderCompare(input));
    var why = renderWhy(result);
    if (why.chips.childNodes.length) card.appendChild(why.chips);
    card.appendChild(why.details);

    var when = marine.time ? "Model wave applies to " + formatWall(marine.time) + "." : "Model time was not included.";
    if (!usingPier && wind && wind.time && marine.time && wind.time.key !== marine.time.key) {
      when += " Wind model applies to " + formatWall(wind.time) + ".";
    }
    if (wind && wind.cell) {
      when += " Hourly wind uses sea cell " + wind.cell.lat.toFixed(3) + ", " + wind.cell.lon.toFixed(3) + ".";
    } else {
      when += " Hourly wind is hidden because the forecast cell did not move off the inland side.";
    }
    card.appendChild(el("p", "card-note", when));

    var hours = renderHourTable(spot, marine, wind);
    if (hours) {
      card.appendChild(el("h4", null, "Next 12 hours"));
      card.appendChild(hours);
    }
    var days = renderDayTable(spot, marine, wind, state.today);
    if (days) {
      card.appendChild(el("h4", null, "Next 5 days"));
      card.appendChild(days);
    }
    return card;
  }

  function renderSafety() {
    if (!safetyEl) return;
    var hazard = hazardAt(state.today);
    var copy = S.safetyCopy(hazard);
    safetyEl.replaceChildren();
    if (!copy.show) {
      safetyEl.hidden = true;
      return;
    }
    safetyEl.hidden = false;
    var paragraph = el("p", null, copy.text + " ");
    var link = el("a", null, "NWS Melbourne");
    link.href = copy.href;
    paragraph.appendChild(link);
    safetyEl.appendChild(paragraph);
  }

  function render() {
    rootEl.replaceChildren();
    renderSafety();
    SPOTS.forEach(function (spot, index) {
      rootEl.appendChild(renderCard(spot, state.marines[index], state.winds[index], state.waters[index], state.spreads[index]));
    });
    var summary = "Live conditions updated for Satellite Beach, Cocoa Beach, and Melbourne Beach. Scores use " + levelName(state.level) + ".";
    if (state.hazardsFailed) summary += " Rip risk could not be confirmed, so beginner scores are hidden.";
    statusEl.textContent = summary;
    statusEl.classList.remove("is-error");
    statusEl.setAttribute("aria-busy", "false");
  }

  function showError() {
    statusEl.textContent = "Couldn't load conditions right now.";
    statusEl.classList.add("is-error");
    statusEl.setAttribute("aria-busy", "false");
    rootEl.replaceChildren();
  }

  function fetchJson(url, headers) {
    return fetch(url, { cache: "no-store", headers: headers || {}, signal: AbortSignal.timeout(15000) }).then(function (response) {
      if (!response.ok) throw new Error("Request failed");
      return response.json();
    }).then(function (data) {
      if (data && data.error) throw new Error(data.reason || "Request failed");
      return data;
    });
  }

  function marineUrl(params) {
    var query = new URLSearchParams();
    query.set("latitude", SPOTS.map(function (item) { return item.lat; }).join(","));
    query.set("longitude", SPOTS.map(function (item) { return item.lon; }).join(","));
    Object.keys(params).forEach(function (key) { query.set(key, params[key]); });
    return "https://marine-api.open-meteo.com/v1/marine?" + query.toString();
  }

  function windUrl(points) {
    var query = new URLSearchParams();
    query.set("latitude", points.map(function (item) { return item.lat; }).join(","));
    query.set("longitude", points.map(function (item) { return item.lon; }).join(","));
    query.set("current", "wind_speed_10m,wind_direction_10m,wind_gusts_10m");
    query.set("hourly", "wind_speed_10m,wind_direction_10m,wind_gusts_10m");
    query.set("wind_speed_unit", "mph");
    query.set("timezone", "America/New_York");
    query.set("forecast_days", "5");
    return "https://api.open-meteo.com/v1/forecast?" + query.toString();
  }

  function acceptWind(place, block) {
    if (!block) return null;
    var moved = S.windCellMoved(
      { lon: place.lon, inlandLon: place.inlandLon },
      { lat: block.latitude, lon: block.longitude }
    );
    if (!moved) return null;
    return buildWind(block);
  }

  function loadWind() {
    var primary = SPOTS.map(function (item) { return { lat: item.windLat, lon: item.windLon }; });
    return fetchJson(windUrl(primary)).then(function (data) {
      var blocks = locationList(data) || [];
      var accepted = SPOTS.map(function (item, index) { return acceptWind(item, blocks[index]); });
      var retries = [];
      SPOTS.forEach(function (item, index) {
        if (accepted[index]) return;
        retries.push(fetchJson(windUrl([{ lat: item.windLat, lon: item.windLonFallback }])).then(function (fallback) {
          var list = locationList(fallback);
          accepted[index] = acceptWind(item, list && list[0]);
        }).catch(function () { accepted[index] = null; }));
      });
      return Promise.all(retries).then(function () { return accepted; });
    });
  }

  function tideUrl(today) {
    var end = addDays(today, 2);
    var query = new URLSearchParams();
    query.set("begin_date", ymdCompact(today));
    query.set("end_date", ymdCompact(end));
    query.set("station", "8721604");
    query.set("product", "predictions");
    query.set("datum", "MLLW");
    query.set("time_zone", "lst_ldt");
    query.set("interval", "hilo");
    query.set("units", "english");
    query.set("format", "json");
    query.set("application", "satellite-beach-surf-guide");
    return "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?" + query.toString();
  }

  function pierUrl() {
    var query = new URLSearchParams();
    query.set("date", "latest");
    query.set("station", "8721604");
    query.set("product", "wind");
    query.set("time_zone", "lst_ldt");
    query.set("units", "english");
    query.set("format", "json");
    query.set("application", "satellite-beach-surf-guide");
    return "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?" + query.toString();
  }

  function buildTideSeries(data) {
    var list = [];
    var predictions = data && data.predictions;
    if (!Array.isArray(predictions)) return list;
    predictions.forEach(function (item) {
      var wall = parseWall(item.t);
      var height = num(item.v);
      if (!wall || height == null) return;
      list.push({ t: stamp(wall), v: height, type: item.type });
    });
    list.sort(function (a, b) { return a.t - b.t; });
    return list;
  }

  function renderTides(data, now) {
    var predictions = data && data.predictions;
    if (!tideEl || !Array.isArray(predictions)) return;
    var nextHigh = null;
    var nextLow = null;
    predictions.forEach(function (item) {
      var wall = parseWall(item.t);
      var height = num(item.v);
      if (!wall || height == null) return;
      if (stamp(wall) < stamp(now)) return;
      if (item.type === "H" && (!nextHigh || stamp(wall) < stamp(nextHigh.wall))) nextHigh = { wall: wall, height: height };
      if (item.type === "L" && (!nextLow || stamp(wall) < stamp(nextLow.wall))) nextLow = { wall: wall, height: height };
    });
    if (!nextHigh && !nextLow) return;
    tideEl.replaceChildren();
    tideEl.appendChild(document.createTextNode("Next predicted tides at Port Canaveral (Trident Pier), datum MLLW: "));
    function appendTide(kind, tide) {
      if (!tide) {
        tideEl.appendChild(document.createTextNode(kind + " n/a"));
        return;
      }
      tideEl.appendChild(document.createTextNode(kind + " " + tide.height.toFixed(1) + " ft at " + formatWall(tide.wall)));
    }
    appendTide("high", nextHigh);
    tideEl.appendChild(document.createTextNode(". "));
    appendTide("low", nextLow);
    tideEl.appendChild(document.createTextNode(". This station is not the beach. Tide only nudges the score, and that preference is low confidence."));
  }

  function parsePier(data, now) {
    var row = data && data.data && data.data[0];
    if (!row) return null;
    var wall = parseWall(row.t);
    var knots = num(row.s);
    var gustKnots = num(row.g);
    var dir = num(row.d);
    if (!wall || knots == null) return null;
    /* NOAA english wind speeds are knots. lst_ldt has no offset, so compare Eastern wall clocks. */
    var fresh = Math.abs(stamp(now) - stamp(wall)) <= PIER_MAX_AGE_MS;
    return {
      mph: knots * KNOTS_TO_MPH,
      gust: gustKnots == null ? null : gustKnots * KNOTS_TO_MPH,
      dir: dir,
      wall: wall,
      fresh: fresh
    };
  }

  function fetchSurfZone() {
    var headers = { Accept: "application/geo+json" };
    return fetchJson("https://api.weather.gov/products/types/SRF/locations/MLB", headers).then(function (index) {
      var graph = index["@graph"] || [];
      var first = graph[0];
      if (!first) throw new Error("No surf zone forecast");
      var url = first["@id"] || first.id;
      return fetchJson(url, headers).then(function (product) {
        return {
          text: product.productText || "",
          issued: S.easternWall(new Date(first.issuanceTime || product.issuanceTime || Date.now()))
        };
      });
    });
  }

  function heightList(data) {
    var blocks = locationList(data) || [];
    return blocks.map(function (block) {
      var units = unitsOf(block);
      var current = block.current || {};
      return toFeet(current.wave_height, units.wave_height);
    });
  }

  function load() {
    var today = S.easternWall(new Date());
    state.today = today;
    var marinePromise = fetchJson(marineUrl({
      current: "wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,wave_period,wind_wave_height,wind_wave_period",
      hourly: "wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,wave_period,wind_wave_height,wind_wave_period",
      length_unit: "imperial",
      timezone: "America/New_York",
      forecast_days: "5",
      models: "ncep_gfswave016",
      cell_selection: "sea"
    }));
    var francePromise = fetchJson(marineUrl({
      current: "wave_height,wave_period",
      length_unit: "imperial",
      timezone: "America/New_York",
      forecast_days: "1",
      models: "meteofrance_wave",
      cell_selection: "sea"
    }));
    var ecmwfPromise = fetchJson(marineUrl({
      current: "wave_height,wave_period",
      length_unit: "imperial",
      timezone: "America/New_York",
      forecast_days: "1",
      models: "ecmwf_wam025",
      cell_selection: "sea"
    }));
    var windPromise = loadWind();
    var waterPromise = fetchJson(marineUrl({
      current: "sea_surface_temperature",
      timezone: "America/New_York",
      forecast_days: "1",
      cell_selection: "sea"
    }));
    var tidePromise = fetchJson(tideUrl(today));
    var pierPromise = fetchJson(pierUrl());
    var alertPromise = fetchJson("https://api.weather.gov/alerts/active?zone=" + S.HAZARD_ZONE, { Accept: "application/geo+json" });
    var surfPromise = fetchSurfZone();

    Promise.allSettled([marinePromise, windPromise, waterPromise, tidePromise, pierPromise, alertPromise, surfPromise, francePromise, ecmwfPromise]).then(function (results) {
      if (results[3].status === "fulfilled") {
        state.tideSeries = buildTideSeries(results[3].value);
        try { renderTides(results[3].value, today); } catch (error) { if (tideEl) tideEl.replaceChildren(); }
      }
      if (results[0].status !== "fulfilled") {
        showError();
        return;
      }
      var marineBlocks = locationList(results[0].value);
      if (!marineBlocks || marineBlocks.length !== SPOTS.length) {
        showError();
        return;
      }
      state.marines = marineBlocks.map(function (block) {
        try { return buildMarine(block); } catch (error) { return null; }
      });
      state.winds = results[1].status === "fulfilled" && Array.isArray(results[1].value) ? results[1].value : SPOTS.map(function () { return null; });
      var waterBlocks = results[2].status === "fulfilled" ? locationList(results[2].value) : null;
      state.waters = SPOTS.map(function (item, index) {
        if (!waterBlocks || !waterBlocks[index]) return null;
        var units = unitsOf(waterBlocks[index]);
        var current = waterBlocks[index].current || {};
        return waterFahrenheit(current.sea_surface_temperature, units.sea_surface_temperature);
      });
      state.pier = results[4].status === "fulfilled" ? parsePier(results[4].value, today) : null;
      state.alerts = results[5].status === "fulfilled" ? results[5].value : null;
      state.parsed = null;
      if (results[6].status === "fulfilled" && results[6].value && results[6].value.text) {
        state.parsed = S.parseSurfZone(results[6].value.text, { zone: S.HAZARD_ZONE, issued: results[6].value.issued });
      }
      var probe = hazardAt(today);
      state.hazardsFailed = !probe.loaded;
      var gfsHeights = state.marines.map(function (marine) { return marine ? marine.waveFt : null; });
      var franceHeights = results[7].status === "fulfilled" ? heightList(results[7].value) : [];
      var ecmwfHeights = results[8].status === "fulfilled" ? heightList(results[8].value) : [];
      state.spreads = SPOTS.map(function (item, index) {
        return S.modelSpread([gfsHeights[index], franceHeights[index], ecmwfHeights[index]]);
      });
      state.ready = true;
      render();
    }).catch(function () {
      showError();
    });
  }

  bindLevel();
  load();
})();
