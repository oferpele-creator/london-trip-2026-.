/* London trip plan: vanilla JS, no build step. */
(() => {
  "use strict";

  /* ================= state ================= */
  const KEY = "ldn-trip-v1";
  const DEF = { lang: "he", theme: "auto", home: { ...TRIP.home }, packing: {}, expenses: [], names: null, rate: null, notes: {}, visited: {}, flex: "auto", alerts: false, notified: {}, near: { onlyOpen: true } };
  let S = Object.assign({}, DEF, safeParse(localStorage.getItem(KEY)) || {});
  function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { console.warn(e); } }

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const bx = (s) => esc(s).replace(/(\d[\d:.]*\s?[–-]\s?\d[\d:.]*(?:°C)?)/g, '<bdi dir="ltr">$1</bdi>');
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const t = (k) => I18N[S.lang][k] ?? I18N.en[k] ?? k;
  const tr = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o[S.lang] ?? o.en : o);
  const P = Object.fromEntries(PLACES.map((p) => [p.id, p]));
  const names = () => S.names || TRIP.travellers.map(tr);

  /* ================= time helpers (Europe/London) ================= */
  function londonNow() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    return { date: `${parts.year}-${parts.month}-${parts.day}`, mins: +parts.hour * 60 + +parts.minute, dow };
  }
  const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
  const fmtMin = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
  const dowOf = (date) => new Date(date + "T12:00:00Z").getUTCDay();
  function fmtDate(date, long) {
    const d = new Date(date + "T12:00:00Z");
    const w = t("dayWord")[d.getUTCDay()], m = t("months")[d.getUTCMonth()];
    return long ? `${w} · ${d.getUTCDate()} ${m}` : `${w} ${d.getUTCDate()}`;
  }
  function durMin(s) { if (!s || s === "—") return 60; let m = 0; const h = s.match(/(\d+)h/); const mm = s.match(/(\d+)m/); if (h) m += +h[1] * 60; if (mm) m += +mm[1]; return m || 60; }

  function isOpen(p, when = londonNow()) {
    const day = p.hours?.[when.dow];
    if (!day) return false;
    return day.split(",").some((r) => { const [a, b] = r.split("-"); return when.mins >= toMin(a) && when.mins < toMin(b); });
  }

  /* ================= geo ================= */
  function coords(p) { if (p.id === "home") return S.home.lat ? [S.home.lat, S.home.lng] : null; return p.lat ? [p.lat, p.lng] : null; }
  function km(a, b) { const R = 6371, r = Math.PI / 180; const dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r; const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
  function leg(a, b) {
    const ca = coords(a), cb = coords(b);
    if (!ca || !cb) return null;
    const d = km(ca, cb);
    if (d < 0.05) return { mode: "none", min: 0, d };
    if (d <= 1.3) return { mode: "walk", min: Math.max(3, Math.round((d * 1.25 * 1000) / 80)), d, ca, cb };
    return { mode: "transit", min: Math.round(10 + (d * 1.3 * 1000) / (d > 8 ? 450 : 330)), d, ca, cb };
  }
  const dirUrl = (ca, cb, mode) => `https://www.google.com/maps/dir/?api=1&origin=${ca}&destination=${cb}&travelmode=${mode === "walk" ? "walking" : "transit"}`;
  const cityUrl = (cb) => `https://citymapper.com/directions?endcoord=${cb[0]},${cb[1]}`;

  /* ================= plan ================= */
  let WX = null; // weather by date
  function flexAssign() {
    // returns {"2026-11-22": "outdoor"|"indoor", "2026-11-23": ...}
    let outdoorFirst = true, reason = "default";
    const a = WX?.["2026-11-22"], b = WX?.["2026-11-23"];
    if (a && b) {
      const score = (w) => w.sun / 3600 - w.pp / 25 - w.ps;
      outdoorFirst = score(a) >= score(b); reason = "weather";
    }
    if (S.flex === "swap") outdoorFirst = !outdoorFirst;
    return { "2026-11-22": outdoorFirst ? "outdoor" : "indoor", "2026-11-23": outdoorFirst ? "indoor" : "outdoor", reason };
  }
  function dayPlan(day) {
    if (!day.flex) return { title: day.title, stops: day.stops, alt: day.alt || [] };
    const kind = flexAssign()[day.date];
    const plan = FLEX_PLANS[kind];
    const stops = plan.stops.map((s) => {
      if (s.mondaySwap && dowOf(day.date) === 1) return { ...s, p: s.mondaySwap, swapped: true };
      return s;
    });
    return { title: plan.title, stops, alt: [], kind };
  }
  function allPlanned() {
    const map = {};
    DAYS.forEach((d, i) => dayPlan(d).stops.forEach((s, j) => { (map[s.p] = map[s.p] || []).push({ di: i, n: j + 1, date: d.date, t: s.t }); }));
    return map;
  }

  /* ================= weather (Open-Meteo) ================= */
  const WMO = (c) => {
    if (c === 0) return ["☀️", "בהיר", "Clear"];
    if (c <= 2) return ["🌤", "מעונן חלקית", "Partly cloudy"];
    if (c === 3) return ["☁️", "מעונן", "Cloudy"];
    if (c <= 48) return ["🌫", "ערפל", "Fog"];
    if (c <= 57) return ["🌦", "טפטוף", "Drizzle"];
    if (c <= 67) return ["🌧", "גשם", "Rain"];
    if (c <= 77) return ["🌨", "שלג", "Snow"];
    if (c <= 82) return ["🌧", "ממטרים", "Showers"];
    if (c <= 86) return ["🌨", "ממטרי שלג", "Snow showers"];
    return ["⛈", "סופות רעמים", "Thunderstorm"];
  };
  async function loadWeather() {
    const c = safeParse(localStorage.getItem("ldn-wx"));
    if (c && Date.now() - c.at < 3 * 3600e3) { WX = c.data; return; }
    const base = "https://api.open-meteo.com/v1/forecast?latitude=51.5072&longitude=-0.1276&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunshine_duration,sunset&timezone=Europe%2FLondon";
    let j = null;
    try { const r = await fetch(`${base}&start_date=${TRIP.start}&end_date=${TRIP.end}`); if (r.ok) j = await r.json(); } catch {}
    if (!j?.daily) { try { const r = await fetch(`${base}&forecast_days=16`); if (r.ok) j = await r.json(); } catch {} }
    if (!j?.daily) return;
    const d = j.daily, out = {};
    d.time.forEach((date, i) => { if (date >= TRIP.start && date <= TRIP.end) out[date] = { code: d.weather_code[i], tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], pp: d.precipitation_probability_max[i] ?? 0, ps: d.precipitation_sum[i] ?? 0, sun: d.sunshine_duration[i] ?? 0, sunset: (d.sunset[i] || "").slice(11, 16) }; });
    if (Object.keys(out).length) { WX = out; localStorage.setItem("ldn-wx", JSON.stringify({ at: Date.now(), data: out })); }
  }
  const isWet = (w) => w && (w.pp >= 60 || w.ps >= 3);

  /* ================= images (Wikimedia Commons, with credit) ================= */
  let IMG = safeParse(localStorage.getItem("ldn-img-v1")) || {};
  async function loadImages() {
    if (Object.keys(IMG).length && !IMG._partial) return;
    const want = PLACES.filter((p) => p.wiki?.length);
    const titles = [...new Set(want.flatMap((p) => p.wiki))];
    const fileOf = {};
    try {
      for (let i = 0; i < titles.length; i += 45) {
        const chunk = titles.slice(i, i + 45);
        const u = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=name&redirects=1&format=json&origin=*&titles=${encodeURIComponent(chunk.join("|"))}`;
        const j = await (await fetch(u)).json();
        const alias = {};
        (j.query.normalized || []).forEach((n) => (alias[n.to] = n.from));
        (j.query.redirects || []).forEach((n) => (alias[n.to] = alias[n.from] || n.from));
        Object.values(j.query.pages || {}).forEach((pg) => { if (pg.pageimage) { const orig = alias[pg.title] || pg.title; fileOf[orig.replace(/ /g, "_")] = pg.pageimage; fileOf[pg.title.replace(/ /g, "_")] = pg.pageimage; } });
      }
      const files = [...new Set(Object.values(fileOf))];
      const info = {};
      for (let i = 0; i < files.length; i += 45) {
        const chunk = files.slice(i, i + 45).map((f) => "File:" + f);
        const u = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900&format=json&origin=*&titles=${encodeURIComponent(chunk.join("|"))}`;
        const j = await (await fetch(u)).json();
        const alias = {};
        (j.query.normalized || []).forEach((n) => (alias[n.to] = n.from));
        Object.values(j.query.pages || {}).forEach((pg) => {
          const ii = pg.imageinfo?.[0];
          if (!ii || pg.missing !== undefined) return;
          const m = ii.extmetadata || {};
          const strip = (h) => (h || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          const key = (alias[pg.title] || pg.title).replace(/^File:/, "").replace(/ /g, "_");
          info[key] = { url: ii.thumburl || ii.url, page: ii.descriptionurl, artist: strip(m.Artist?.value).slice(0, 60) || "Unknown", lic: strip(m.LicenseShortName?.value) || "" };
        });
      }
      const out = {};
      want.forEach((p) => { for (const w of p.wiki) { const f = fileOf[w]; const inf = f && (info[f.replace(/ /g, "_")] || info[f]); if (inf) { out[p.id] = inf; break; } } });
      IMG = out;
      localStorage.setItem("ldn-img-v1", JSON.stringify(out));
    } catch (e) { console.warn("images", e); }
  }
  function imgTag(p, cls = "") {
    const im = IMG[p.id];
    if (!im) return `<span aria-hidden="true">${CATS[p.cat].icon}</span>`;
    return `<img class="${cls}" loading="lazy" src="${esc(im.url)}" alt="${esc(tr(p.name))}" onerror="this.replaceWith(document.createTextNode('${CATS[p.cat].icon}'))">`;
  }
  function creditTag(p) {
    const im = IMG[p.id];
    if (!im) return `<div class="credit">${t("noPhoto")}</div>`;
    return `<div class="credit">${t("photoCredit")}: <a href="${esc(im.page)}" target="_blank" rel="noopener">${esc(im.artist)}</a>${im.lic ? " · " + esc(im.lic) : ""} · Wikimedia Commons</div>`;
  }

  /* ================= TfL ================= */
  const TFL = "https://api.tfl.gov.uk";
  let STATUS = null, statusAt = 0;
  async function lineStatus() {
    if (STATUS && Date.now() - statusAt < 120e3) return STATUS;
    const r = await fetch(`${TFL}/Line/Mode/tube,elizabeth-line,dlr,overground/Status`);
    if (!r.ok) throw new Error("tfl");
    STATUS = await r.json(); statusAt = Date.now();
    return STATUS;
  }
  const stopIdCache = safeParse(localStorage.getItem("ldn-stopids")) || {};
  async function stopId(name) {
    if (stopIdCache[name]) return stopIdCache[name];
    const r = await fetch(`${TFL}/StopPoint/Search/${encodeURIComponent(name)}?modes=tube,elizabeth-line,dlr,overground`);
    const j = await r.json();
    const id = j.matches?.[0]?.id;
    if (id) { stopIdCache[name] = id; localStorage.setItem("ldn-stopids", JSON.stringify(stopIdCache)); }
    return id;
  }
  async function arrivals(name) {
    const id = await stopId(name);
    if (!id) return [];
    const r = await fetch(`${TFL}/StopPoint/${id}/Arrivals`);
    const j = await r.json();
    return j.sort((a, b) => a.timeToStation - b.timeToStation).slice(0, 10);
  }
  const lineKey = (id) => (["liberty", "lioness", "mildmay", "suffragette", "weaver", "windrush"].includes(id) ? "overground" : id);

  /* ================= photos (IndexedDB) ================= */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => { const r = indexedDB.open("ldn-trip", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return dbp;
  }
  async function photosFor(pid) {
    const d = await db();
    return new Promise((res) => { const out = []; const c = d.transaction("photos").objectStore("photos").openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur) return res(out); if (!pid || cur.value.pid === pid) out.push(cur.value); cur.continue(); }; c.onerror = () => res(out); });
  }
  async function addPhoto(pid, file) {
    const blob = await shrink(file, 1280);
    const d = await db();
    return new Promise((res) => { const tx = d.transaction("photos", "readwrite"); tx.objectStore("photos").put({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 6), pid, at: Date.now(), blob }); tx.oncomplete = res; });
  }
  async function delPhoto(id) { const d = await db(); return new Promise((res) => { const tx = d.transaction("photos", "readwrite"); tx.objectStore("photos").delete(id); tx.oncomplete = res; }); }
  function shrink(file, max) {
    return new Promise((res) => {
      const img = new Image(); const u = URL.createObjectURL(file);
      img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob((b) => res(b || file), "image/jpeg", 0.82); };
      img.onerror = () => res(file); img.src = u;
    });
  }

  /* ================= UI chrome ================= */
  function applyTheme() {
    const dark = S.theme === "dark" || (S.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]').content = dark ? "#070d3d" : "#1a3bd1";
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  function applyLang() { document.documentElement.lang = S.lang; document.documentElement.dir = S.lang === "he" ? "rtl" : "ltr"; }

  function renderChrome() {
    $("#hdr").innerHTML = `
      <svg class="burst" viewBox="0 0 40 40" aria-hidden="true"><g stroke="#da291c" stroke-width="3.4" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => `<line x1="20" y1="20" x2="${20 + 17 * Math.cos((i * Math.PI) / 4)}" y2="${20 + 17 * Math.sin((i * Math.PI) / 4)}"/>`).join("")}</g><circle cx="20" cy="20" r="4" fill="#da291c"/></svg>
      <div><div class="logo">LONDON</div><div class="sub">${t("tripPlan")} · <bdi dir="ltr">20–24.11.2026</bdi></div><div class="px" style="font-size:9px;margin-top:4px;color:var(--muted)">${DAYS.length} ${t("days")} · ${PLACES.length} ${t("places")}</div></div>
      <svg class="bus" viewBox="0 0 64 40" aria-hidden="true"><rect x="2" y="2" width="58" height="30" rx="5" fill="#da291c" stroke="#111" stroke-width="3"/><g fill="#fff6e0" stroke="#111" stroke-width="2">${[8, 21, 34, 47].map((x) => `<rect x="${x}" y="7" width="10" height="8" rx="1"/><rect x="${x}" y="19" width="10" height="7" rx="1"/>`).join("")}</g><circle cx="15" cy="34" r="5" fill="#111"/><circle cx="48" cy="34" r="5" fill="#111"/></svg>`;
    const now = londonNow();
    const di = DAYS.findIndex((d) => d.date === now.date);
    $("#toolbar").innerHTML = `
      <button class="pill" id="nearBtn">📍 ${t("nearMe")}</button>
      ${di >= 0 ? `<span class="pill px">${t("day")} ${di + 1}</span>` : ""}
      <span class="sp"></span>
      <div class="seg" role="group" aria-label="language"><button data-lang="he" class="${S.lang === "he" ? "on" : ""}">עב</button><button data-lang="en" class="${S.lang === "en" ? "on" : ""}">EN</button></div>
      <button class="pill" id="themeBtn" aria-label="${t("theme")}">${{ auto: "🌓", light: "☀️", dark: "🌙" }[S.theme]}</button>`;
    $$("[data-lang]").forEach((b) => (b.onclick = () => { S.lang = b.dataset.lang; save(); applyLang(); renderAll(); }));
    $("#themeBtn").onclick = () => { S.theme = { auto: "light", light: "dark", dark: "auto" }[S.theme]; save(); applyTheme(); renderChrome(); toast(`${t("theme")}: ${t("theme" + S.theme[0].toUpperCase() + S.theme.slice(1))}`); };
    $("#nearBtn").onclick = () => { location.hash = "#/places/near"; };
    const tabs = [["timeline", "🗓"], ["map", "📍"], ["places", "❤"], ["money", "💷"], ["info", "🧳"]];
    const cur = route().tab;
    $("#nav").innerHTML = tabs.map(([k, ic]) => `<a href="#/${k}" class="${cur === k ? "on" : ""}"><span class="ic">${ic}</span>${t("nav_" + k)}</a>`).join("");
    $("#fab").setAttribute("aria-label", t("ask"));
    $("#fab").title = t("ask");
  }

  function toast(msg) { const el = document.createElement("div"); el.className = "toast"; el.textContent = msg; document.body.appendChild(el); setTimeout(() => el.remove(), 2600); }

  /* ================= router ================= */
  function route() {
    const h = location.hash.replace(/^#\/?/, "").split("/");
    return { tab: ["timeline", "map", "places", "money", "info"].includes(h[0]) ? h[0] : h[0] === "" ? "timeline" : null, raw: h };
  }
  let curDay = null;
  function renderAll() {
    renderChrome();
    const r = route();
    if (r.raw[0] === "p") { openPlace(r.raw[1]); return; }
    if (r.raw[0] === "summary") { openSummary(); return; }
    closeSheet();
    const tab = r.tab || "timeline";
    if (tab === "timeline") renderTimeline(r.raw[1]);
    if (tab === "map") renderMap();
    if (tab === "places") renderPlaces(r.raw[1] === "near");
    if (tab === "money") renderMoney();
    if (tab === "info") renderInfo();
  }
  let lastTab = "#/timeline";
  window.addEventListener("hashchange", () => { const r = route(); if (r.tab) lastTab = location.hash; renderAll(); });
  function closeSheet() { const s = $("#sheet"); s.classList.add("hidden"); s.innerHTML = ""; document.body.style.overflow = ""; }
  function goBack() { if (history.length > 1 && sessionStorage.getItem("ldn-nav")) history.back(); else location.hash = lastTab; }

  /* ================= timeline ================= */
  function renderTimeline(dateArg) {
    const now = londonNow();
    if (dateArg) curDay = dateArg;
    if (!curDay) curDay = DAYS.some((d) => d.date === now.date) ? now.date : DAYS[0].date;
    const di = DAYS.findIndex((d) => d.date === curDay);
    const day = DAYS[di];
    const plan = dayPlan(day);
    const w = WX?.[day.date];
    const fa = flexAssign();

    const tabs = DAYS.map((d, i) => { const ww = WX?.[d.date]; return `<button class="daytab ${d.date === curDay ? "on" : ""}" style="--dc:${d.color}" data-date="${d.date}"><span class="num">${i + 1}${ww ? `<span class="wx">${WMO(ww.code)[0]}</span>` : ""}</span><span class="d">${fmtDate(d.date)}</span></button>`; }).join("");

    let wxHtml;
    if (w) {
      const [ic, he, en] = WMO(w.code);
      const wet = isWet(w);
      const rec = PLACES.filter((p) => (wet ? ["museum", "shop"].includes(p.cat) || p.id === "warrooms" : ["park", "view", "market", "sight"].includes(p.cat)) && p.lat).slice(0, 6);
      wxHtml = `<div class="card weather"><div class="main"><span class="e">${ic}</span><span>${S.lang === "he" ? he : en} · <bdi dir="ltr">${Math.round(w.tmin)}–${Math.round(w.tmax)}°C</bdi> · ${t("rain")} ${w.pp}% · ${t("sunset")} ${w.sunset}</span></div>
        <div class="rec"><div class="lbl">${wet ? t("wetDay") : t("dryDay")}</div><div class="chips">${rec.map((p) => `<a class="pill" href="#/p/${p.id}">${CATS[p.cat].icon} ${esc(tr(p.name))}</a>`).join("")}</div></div></div>`;
    } else wxHtml = `<div class="card weather"><div class="muted">${WX === null ? t("weatherLoading") : t("weatherNA")}</div></div>`;

    let banners = "";
    if (day.flex) {
      banners += `<div class="banner">${plan.kind === "outdoor" ? "☀️ " + t("outdoorBanner") : "🏛 " + t("indoorBanner")}${fa.reason !== "weather" ? ` <span class="unv">${t("weatherNA").split("(")[0].trim()}</span>` : ""}</div>
      <div class="row" style="margin:-4px 0 14px"><button class="pill" id="swapBtn">🔁 ${S.flex === "swap" ? t("autoDays") : t("swapDays")}</button></div>`;
    }
    if (plan.stops.some((s) => s.swapped)) banners += `<div class="banner alert">⚠ ${t("mondaySwap")}</div>`;
    if (plan.stops.some((s) => s.p === "home") && !S.home.lat) banners += `<div class="banner alert">🏠 ${t("setHome")} <a href="#/info">→</a></div>`;
    banners += `<div id="disrupt"></div>`;

    const stopsHtml = plan.stops.map((s, i) => {
      const p = P[s.p];
      const next = plan.stops[i + 1];
      const isToday = day.date === now.date;
      const st = isToday ? (next && toMin(next.t) <= now.mins ? "past" : toMin(s.t) <= now.mins ? "now" : "") : "";
      let legHtml = "";
      if (next) {
        const l = leg(p, P[next.p]);
        if (l && l.mode !== "none") {
          const leave = toMin(next.t) - l.min - 5;
          legHtml = `<div class="leg"><span class="ln">${l.mode === "walk" ? "🚶" : "🚇"} ≈${l.min} ${t("min")}</span><span>${t("leaveBy")}${fmtMin(leave)}</span><a href="${dirUrl(l.ca, l.cb, l.mode)}" target="_blank" rel="noopener">${t("navTo")} ↗</a></div>`;
        } else if (!l) legHtml = `<div class="leg"><span class="ln">— ${t("min")}</span></div>`;
        else legHtml = `<div class="leg"></div>`;
      }
      return stopCard(p, s, i + 1, st) + legHtml;
    }).join("");

    const altHtml = plan.alt.length ? `<h3 style="color:#fff;margin:22px 0 10px">${t("altDinner")}</h3><div class="tl alts">${plan.alt.map((s, i) => stopCard(P[s.p], s, "★") + '<div style="height:10px"></div>').join("")}</div>` : "";

    $("#view").innerHTML = `
      <div class="days">${tabs}</div>
      <div class="card dayhead" style="--dc:${day.color}">
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><g stroke="${day.color}" stroke-width="3.4" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => `<line x1="20" y1="20" x2="${20 + 17 * Math.cos((i * Math.PI) / 4)}" y2="${20 + 17 * Math.sin((i * Math.PI) / 4)}"/>`).join("")}</g></svg>
        <div><div class="lbl">${fmtDate(day.date, true)} · ${esc(tr(day.line))}</div><div class="big">${t("day")} ${di + 1}</div><h2>${esc(tr(plan.title))}</h2></div>
      </div>
      ${wxHtml}${banners}
      <div class="tl" style="--dc:${day.color}">${stopsHtml}</div>
      ${altHtml}`;
    $$(".daytab").forEach((b) => (b.onclick = () => { curDay = b.dataset.date; history.replaceState(null, "", "#/timeline/" + curDay); renderTimeline(); }));
    $$(".stop").forEach((b) => (b.onclick = () => openHash("#/p/" + b.dataset.id)));
    const sw = $("#swapBtn"); if (sw) sw.onclick = () => { S.flex = S.flex === "swap" ? "auto" : "swap"; save(); renderTimeline(); };
    $(".daytab.on")?.scrollIntoView({ inline: "center", block: "nearest" });
    // live disruptions on today's lines
    const lines = new Set(plan.stops.flatMap((s) => P[s.p].station?.lines || []));
    lineStatus().then((all) => {
      const bad = all.filter((l) => lines.has(lineKey(l.id)) && l.lineStatuses.some((s) => s.statusSeverity !== 10));
      if (bad.length && $("#disrupt")) $("#disrupt").innerHTML = `<div class="banner alert">🚧 ${t("disruptions")}: ${bad.map((l) => `${esc(l.name)} (${esc(l.lineStatuses[0].statusSeverityDescription)})`).join(", ")}</div>`;
    }).catch(() => {});
  }
  function stopCard(p, s, n, st = "") {
    const c = CATS[p.cat];
    return `<button class="stop ${st}" data-n="${n}" data-id="${p.id}">
      <div class="th">${imgTag(p)}</div>
      <div class="grow"><div class="time">${s.t}</div><h3>${esc(tr(s.label) || tr(p.name))}</h3>
      <div class="meta"><span class="cat" style="border-color:${c.color}">${c.icon} ${esc(tr(c.label))}</span>${p.duration && p.duration !== "—" ? `<span>⏱ ${p.duration}</span>` : ""}${p.ver === "no" ? `<span class="unv">${t("unverified")}</span>` : ""}</div>
      ${s.note ? `<div class="muted" style="font-size:12px;margin-top:4px">${bx(tr(s.note))}</div>` : ""}</div></button>`;
  }
  function openHash(h) { sessionStorage.setItem("ldn-nav", "1"); location.hash = h; }

  /* ================= place page ================= */
  async function openPlace(id) {
    const p = P[id];
    if (!p) { location.hash = "#/timeline"; return; }
    const pl = allPlanned()[id];
    const isFood = !!p.food;
    const c = CATS[p.cat];
    const sh = $("#sheet");
    const verBadge = p.ver === "ok" ? `<span class="okv">✓ ${t("verified")}</span>` : `<span class="unv">${p.ver === "partial" ? t("partial") : t("unverified")}</span>`;
    const whenTxt = pl ? pl.map((x) => `${fmtDate(x.date)} ${x.t}`).join(" · ") : `★ ${t("wishlist")}`;
    const lines = p.station ? `<span class="lines">${p.station.lines.map((l) => `<i style="background:${LINE_COLORS[l] || "#888"}" title="${l}"></i>`).join("")}</span>` : "";
    const open = p.hours ? (isOpen(p) ? `<span class="opennow y">${t("openNow")}</span>` : `<span class="opennow n">${t("closedNow")}</span>`) : "";
    const cc = coords(p);
    const gmaps = cc ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tr(p.name) + " London")}` : "";
    const li = (arr) => `<ul class="dots">${(tr(arr) || []).map((x) => `<li>${bx(x)}</li>`).join("")}</ul>`;

    let foodHtml = "";
    if (isFood) {
      const f = p.food;
      const stars = f.rating ? "★".repeat(Math.round(f.rating)).padEnd(5, "☆") : "";
      foodHtml = `
      <div class="card rating">
        ${f.rating ? `<div class="n">${f.rating}</div><div><div class="stars">${stars}</div>` : `<div><div class="stars">☆☆☆☆☆</div>`}
        <div style="font-size:13px;font-weight:600">Google${f.reviews ? ` · ${f.reviews.toLocaleString()} ${t("googleReviews")}` : ""}</div>
        ${!f.rating ? `<div class="unv">${t("ratingUnverified")}</div>` : ""}</div>
      </div>
      <div class="row wrap" style="margin:-4px 0 14px">${f.award ? `<span class="pill" style="background:#ffd300;color:#111">🏅 ${esc(tr(f.award))}</span>` : ""}<span class="pill">${esc(tr(f.cuisine))}</span><span class="pill" style="background:#c9f2d3;color:#111">${f.priceLevel}</span></div>
      <div class="strip">
        <div class="ph">${imgTag(p)}${IMG[p.id] ? creditTag(p) : ""}</div>
        <a class="ph" href="${gmaps}" target="_blank" rel="noopener" style="font-size:16px;font-weight:800;text-align:center;padding:10px;text-decoration:none">📷<br>${t("photosOnGoogle")} ↗</a>
      </div>
      <div class="row" style="margin-bottom:14px">${p.bookUrl ? `<a class="btn red grow" href="${p.bookUrl}" target="_blank" rel="noopener">${t("bookTable")} ↗</a>` : ""}${p.menuUrl ? `<a class="btn grow" href="${p.menuUrl}" target="_blank" rel="noopener">${t("fullMenu")} ↗</a>` : ""}</div>
      <div class="card sec"><h3>${t("whatToOrder")}</h3>${f.order.map((o) => `<div class="menu-row"><span>${esc(tr(o.n))}</span><span class="dots"></span><span>${o.p ? "£" + o.p : `<span class="unv">${t("priceUnv")}</span>`}</span></div>`).join("")}</div>
      <div class="card sec tips"><h3>${t("bestTips")}</h3>${li(p.tips)}</div>`;
    }

    sh.innerHTML = `<div class="in">
      <div class="top"><button class="round" id="backBtn" aria-label="${t("back")}">${S.lang === "he" ? "→" : "←"}</button>
        <span class="badge ${pl ? "" : "wish"}">${pl ? `${t("day")} ${pl[0].di + 1} · #${pl[0].n}` : t("wishlist")}</span>
        ${gmaps ? `<a class="round" href="${gmaps}" target="_blank" rel="noopener" aria-label="Google Maps">📍</a>` : `<span class="round">📍</span>`}</div>
      <div class="hero">${imgTag(p)}<div class="shade"></div>${creditTag(p)}<div class="t"><span class="cat" style="position:static;display:inline-flex;margin-bottom:6px;color:#111;background:#fff">${c.icon} ${esc(tr(c.label))}</span><h1>${esc(tr(p.name))}</h1><div class="area">${esc(tr(p.area))}</div></div></div>
      <div class="card"><div style="font-weight:700;line-height:1.45">${bx(tr(p.summary))}</div><div style="margin-top:8px">${verBadge}${tr(p.verNote) ? ` <span class="muted" style="font-size:12px">${bx(tr(p.verNote))}</span>` : ""}</div></div>
      ${foodHtml}
      <div class="facts">
        <div class="fact"><div class="lbl">${t("when")}</div>${esc(whenTxt)}</div>
        <div class="fact"><div class="lbl">${t("howLong")}</div>${esc(p.duration)}</div>
        <div class="fact"><div class="lbl">${t("price")}</div>${bx(tr(p.price))}</div>
        <div class="fact"><div class="lbl">${t("open")}</div>${bx(tr(p.hoursText))}<br>${open}</div>
        <div class="fact"><div class="lbl">${t("tube")}</div>${p.station ? esc(p.station.name) + "<br>" + lines : "—"}</div>
        <div class="fact"><div class="lbl">${t("booking")}</div>${bx(tr(p.booking))}${p.bookUrl && !isFood ? `<br><a href="${p.bookUrl}" target="_blank" rel="noopener" style="font-size:13px">${t("booking")} ↗</a>` : ""}</div>
      </div>
      <div class="card sec"><h3>${t("about")}</h3><div style="line-height:1.5">${bx(tr(p.about))}</div></div>
      ${(tr(p.dontMiss) || []).length ? `<div class="card sec"><h3>${t("dontMiss")}</h3>${li(p.dontMiss)}</div>` : ""}
      ${!isFood && (tr(p.tips) || []).length ? `<div class="card sec tips"><h3>${t("tips")}</h3>${li(p.tips)}</div>` : ""}
      ${(tr(p.facts) || []).length ? `<div class="card sec"><h3>${t("facts")}</h3>${li(p.facts)}</div>` : ""}
      <div class="card sec"><h3>${t("getThere")}</h3>${cc ? `<div class="minimap" id="minimap"></div>
        <div class="row wrap"><a class="btn blue small" href="https://www.google.com/maps/dir/?api=1&destination=${cc}&travelmode=transit" target="_blank" rel="noopener">Google Maps ↗</a><a class="btn small" href="${cityUrl(cc)}" target="_blank" rel="noopener">Citymapper ↗</a><a class="btn small" href="https://www.google.com/maps/dir/?api=1&destination=${cc}&travelmode=walking" target="_blank" rel="noopener">🚶 ${t("walk")}</a></div>` : `<div class="warn">${t("setHome")}</div>`}
      </div>
      ${p.station ? `<div class="card sec live"><h3>🚇 ${t("liveTrains")}: ${esc(p.station.name)}</h3><div id="arr" class="muted">${t("liveLoading")}</div><div id="lst" style="margin-top:8px"></div></div>` : ""}
      <div class="card sec"><h3>📸 ${t("myPhotos")}</h3>
        <label class="chk ${S.visited[id] ? "done" : ""}" style="text-decoration:none"><input type="checkbox" id="visited" ${S.visited[id] ? "checked" : ""}> <b>${t("visited")}</b></label>
        <div class="photos" id="myph"></div>
        <label class="btn small" style="margin:6px 0">➕ ${t("addPhoto")}<input type="file" accept="image/*" multiple id="phIn" hidden></label>
        <label class="f">${t("note")}<textarea id="noteIn" maxlength="400">${esc(S.notes[id] || "")}</textarea></label>
        <button class="btn small yellow" id="noteSave">${t("save")}</button></div>
      ${p.links?.length ? `<div class="card sec"><h3>${t("links")}</h3><div class="row wrap">${p.links.map((l) => `<a class="pill" href="${l.url}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}</div></div>` : ""}
    </div>`;
    sh.classList.remove("hidden");
    sh.scrollTop = 0;
    document.body.style.overflow = "hidden";
    $("#backBtn").onclick = goBack;
    $("#visited").onchange = (e) => { S.visited[id] = e.target.checked; save(); e.target.closest(".chk").classList.toggle("done", e.target.checked); };
    $("#noteSave").onclick = () => { S.notes[id] = $("#noteIn").value.trim(); save(); toast(t("saved")); };
    $("#phIn").onchange = async (e) => { for (const f of e.target.files) await addPhoto(id, f); S.visited[id] = true; save(); drawPhotos(id); toast(t("saved")); };
    drawPhotos(id);
    if (cc) setTimeout(() => miniMap(cc, p), 30);
    if (p.station) {
      arrivals(p.station.name).then((a) => {
        const el = $("#arr"); if (!el) return;
        el.classList.remove("muted");
        el.innerHTML = a.length ? a.map((x) => `<div class="arr"><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid #111;background:${LINE_COLORS[lineKey(x.lineId)] || "#888"}"></i> <b>${esc(x.lineName)}</b> → ${esc(x.towards || x.destinationName || "")} <span class="muted">${esc(x.platformName || "")}</span></span><b>${Math.max(0, Math.round(x.timeToStation / 60))} ${t("min")}</b></div>`).join("") : t("noArrivals");
      }).catch(() => { const el = $("#arr"); if (el) el.textContent = t("liveErr"); });
      lineStatus().then((all) => {
        const el = $("#lst"); if (!el) return;
        const mine = all.filter((l) => p.station.lines.includes(lineKey(l.id)));
        el.innerHTML = `<div class="lbl">${t("lineStatus")}</div>` + mine.map((l) => statusRow(l)).join("");
      }).catch(() => {});
    }
  }
  function statusRow(l) {
    const s = l.lineStatuses[0];
    const ok = s.statusSeverity === 10;
    return `<div class="statusrow"><span class="sw" style="background:${LINE_COLORS[lineKey(l.id)] || "#888"}"></span><b class="grow">${esc(l.name)}</b><span style="font-weight:700;color:${ok ? "#00a650" : "#e32017"}">${ok ? "✓ " + t("goodService") : "⚠ " + esc(s.statusSeverityDescription)}</span></div>${!ok && s.reason ? `<div class="muted" style="font-size:12px;padding:4px 0 6px">${esc(s.reason)}</div>` : ""}`;
  }
  async function drawPhotos(id) {
    const el = $("#myph"); if (!el) return;
    const ph = await photosFor(id);
    el.innerHTML = ph.map((x) => `<div class="p"><img src="${URL.createObjectURL(x.blob)}" alt=""><button data-del="${x.id}" aria-label="${t("delete")}">✕</button></div>`).join("");
    $$("[data-del]", el).forEach((b) => (b.onclick = async () => { await delPhoto(b.dataset.del); drawPhotos(id); }));
  }
  function tileLayer() { return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }); }
  function miniMap(cc, p) {
    const el = $("#minimap"); if (!el || !window.L) return;
    const m = L.map(el, { zoomControl: false, attributionControl: true, dragging: true, scrollWheelZoom: false }).setView(cc, 15);
    tileLayer().addTo(m);
    L.marker(cc, { icon: L.divIcon({ className: "", html: `<div class="pin" style="background:${CATS[p.cat].color}">${CATS[p.cat].icon}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(m);
  }

  /* ================= map tab ================= */
  let MAP = null, mapFilter = "all";
  function renderMap() {
    const planned = allPlanned();
    const chips = [["all", t("all")], ...DAYS.map((d, i) => [String(i), `${t("day")} ${i + 1}`]), ["wish", "★ " + t("wishlist")]];
    $("#view").innerHTML = `${!S.home.lat ? `<div class="banner alert" style="margin:0 0 12px">🏠 ${t("setHome")}</div>` : ""}<div class="mapwrap"><div id="map"></div>
      <div class="mapchips chips">${chips.map(([k, l]) => `<button class="pill ${mapFilter === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("")}</div>
      <div class="mapcard" id="mapcard"></div></div>`;
    $$("[data-f]").forEach((b) => (b.onclick = () => { mapFilter = b.dataset.f; renderMap(); }));
    if (!window.L) return;
    if (MAP) { MAP.remove(); MAP = null; }
    MAP = L.map("map", { zoomControl: true }).setView([51.507, -0.128], 12);
    tileLayer().addTo(MAP);
    const pts = [];
    const add = (p, html, cls, color) => {
      const c = coords(p); if (!c) return;
      const m = L.marker(c, { icon: L.divIcon({ className: "", html: `<div class="pin ${cls}" style="background:${color}">${html}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(MAP);
      m.on("click", () => showMapCard(p, planned[p.id]));
      if ((p.id !== "lhr" && p.id !== "home") || mapFilter === "0" || mapFilter === "4") pts.push(c);
    };
    DAYS.forEach((d, i) => {
      if (mapFilter !== "all" && mapFilter !== String(i)) return;
      const stops = dayPlan(d).stops;
      const line = [];
      stops.forEach((s, j) => { const p = P[s.p]; if (p.id === "home") return; add(p, j + 1, "", d.color); const c = coords(p); if (c) line.push(c); });
      if (mapFilter === String(i) && line.length > 1) L.polyline(line, { color: d.color, weight: 5, opacity: 0.8, dashArray: "2 8" }).addTo(MAP);
    });
    if (mapFilter === "all" || mapFilter === "wish") PLACES.filter((p) => !planned[p.id] && p.cat !== "stay").forEach((p) => add(p, CATS[p.cat].icon, "wish", "#fff"));
    if (S.home.lat) add(P.home, "🏠", "home", "#ffd300");
    if (pts.length) MAP.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
    setTimeout(() => MAP && MAP.invalidateSize(), 60);
  }
  function showMapCard(p, pl) {
    $("#mapcard").innerHTML = `<button class="stop" style="padding:8px" data-id="${p.id}"><div class="th" style="width:56px;height:56px">${imgTag(p)}</div><div class="grow"><h3 style="margin:0">${esc(tr(p.name))}</h3><div class="px muted">${pl ? `${t("day")} ${pl[0].di + 1} · ${pl[0].t}` : "★ " + t("wishlist")}</div></div><span class="round" style="width:38px;height:38px;background:var(--bus);color:#fff">${S.lang === "he" ? "←" : "→"}</span></button>`;
    $("#mapcard .stop").onclick = () => openHash("#/p/" + p.id);
  }

  /* ================= places tab ================= */
  let pq = "", pcat = "all", NEAR = null;
  function renderPlaces(near) {
    const planned = allPlanned();
    const cats = ["all", ...Object.keys(CATS).filter((k) => PLACES.some((p) => p.cat === k))];
    $("#view").innerHTML = `
      <div class="search">🔍<input id="q" type="search" placeholder="${t("search")}" value="${esc(pq)}" aria-label="${t("search")}"></div>
      <div class="chips">${cats.map((k) => `<button class="pill ${pcat === k ? "on" : ""}" data-c="${k}">${k === "all" ? t("all") : CATS[k].icon + " " + esc(tr(CATS[k].label))}</button>`).join("")}</div>
      <div id="nearbox"></div>
      <div class="grid" id="pgrid"></div>`;
    const draw = () => {
      const q = pq.toLowerCase();
      let list = PLACES.filter((p) => (pcat === "all" || p.cat === pcat) && (!q || [p.name.he, p.name.en, p.area.he, p.area.en, p.summary.he, p.summary.en].join(" ").toLowerCase().includes(q)));
      if (NEAR?.pos) {
        list = list.filter((p) => coords(p)).map((p) => ({ p, d: km(NEAR.pos, coords(p)) }));
        if (S.near.onlyOpen) list = list.filter((x) => isOpen(x.p));
        list.sort((a, b) => a.d - b.d);
        $("#pgrid").innerHTML = list.length ? list.map(({ p, d }) => pcard(p, planned[p.id], (() => { const w = Math.round((d * 1.25 * 1000) / 80); return w <= 35 ? `<span class="dist">🚶 ${w} ${t("walkMin")}</span>` : `<span class="dist">🚇 ≈${Math.round(10 + (d * 1.3 * 1000) / 330)} ${t("min")} · ${d.toFixed(1)} km</span>`; })())).join("") : `<div class="card" style="grid-column:1/-1">${t("nearNone")}</div>`;
      } else $("#pgrid").innerHTML = list.map((p) => pcard(p, planned[p.id])).join("");
      $$(".pcard").forEach((b) => (b.onclick = () => openHash("#/p/" + b.dataset.id)));
    };
    $("#q").oninput = (e) => { pq = e.target.value; draw(); };
    $$("[data-c]").forEach((b) => (b.onclick = () => { pcat = b.dataset.c; renderPlaces(near); }));
    if (near) {
      const box = $("#nearbox");
      const head = (msg) => `<div class="card"><div class="row"><b class="grow">📍 ${t("nearTitle")}</b><button class="pill" id="nearOff">✕</button></div><label class="chk" style="border:0"><input type="checkbox" id="onlyOpen" ${S.near.onlyOpen ? "checked" : ""}> ${t("onlyOpen")}</label>${msg ? `<div class="muted">${msg}</div>` : ""}</div>`;
      const wire = () => { $("#nearOff").onclick = () => { NEAR = null; location.hash = "#/places"; }; $("#onlyOpen").onchange = (e) => { S.near.onlyOpen = e.target.checked; save(); draw(); }; };
      if (NEAR?.pos && Date.now() - NEAR.at < 120e3) { box.innerHTML = head(""); wire(); draw(); return; }
      box.innerHTML = head(t("nearLocating")); wire();
      navigator.geolocation?.getCurrentPosition((pos) => { NEAR = { pos: [pos.coords.latitude, pos.coords.longitude], at: Date.now() }; box.innerHTML = head(""); wire(); draw(); }, () => { box.innerHTML = head(t("nearErr")); wire(); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    } else NEAR = null;
    draw();
  }
  function pcard(p, pl, extra = "") {
    const d = pl ? DAYS[pl[0].di] : null;
    return `<button class="pcard" data-id="${p.id}"><div class="im">${imgTag(p)}</div><div class="bd">
      ${d ? `<span class="daybadge" style="--dc:${d.color}">${t("day")} ${pl[0].di + 1}</span>` : `<span class="daybadge" style="--dc:#ee7c0e">★ ${t("wishlist")}</span>`}
      <h3>${esc(tr(p.name))}</h3><div class="area">${CATS[p.cat].icon} ${esc(tr(p.area))}</div>${extra}</div></button>`;
  }

  /* ================= money tab ================= */
  let RATE = null;
  async function loadRate() {
    const c = safeParse(localStorage.getItem("ldn-rate"));
    if (c && Date.now() - c.at < 12 * 3600e3) { RATE = c; return; }
    try { const j = await (await fetch("https://open.er-api.com/v6/latest/GBP")).json(); if (j.rates?.ILS) { RATE = { v: j.rates.ILS, at: Date.now(), live: true }; localStorage.setItem("ldn-rate", JSON.stringify(RATE)); } } catch {}
  }
  function renderMoney() {
    const nm = names();
    const rate = RATE?.v || S.rate || 4.5;
    const ils = (g) => "₪" + Math.round(g * rate).toLocaleString();
    const net = [0, 0];
    S.expenses.forEach((e) => { const other = 1 - e.payer; if (e.split === "full") { net[e.payer] += e.gbp; net[other] -= e.gbp; } else { net[e.payer] += e.gbp / 2; net[other] -= e.gbp / 2; } });
    const total = S.expenses.reduce((a, e) => a + e.gbp, 0);
    const owe = net[0] > 0.005 ? [1, 0, net[0]] : net[1] > 0.005 ? [0, 1, net[1]] : null;
    $("#view").innerHTML = `
      <div class="card" style="background:var(--paper)"><div class="lbl">${t("expenses")}</div>
        <div class="bal">${owe ? `<span>${esc(nm[owe[0]])} ${t("owes")}${esc(nm[owe[1]])}</span><span>£${owe[2].toFixed(2)}<br><small class="muted">${ils(owe[2])}</small></span>` : `<span>${t("settled")}</span>`}</div>
        <div class="muted" style="margin-top:8px;font-size:13px">${t("total")}: £${total.toFixed(2)} · ${ils(total)} · ${t("rate")} 1£ = ₪${rate.toFixed(3)} ${RATE?.live ? `<span class="okv">${t("rateLive")}</span>` : `<span class="unv">${t("rateFallback")}</span>`}</div></div>
      <div class="card"><h3 style="margin-bottom:8px">➕ ${t("addExpense")}</h3>
        <label class="f">${t("what")}<input type="text" id="eDesc" maxlength="60"></label>
        <div class="row"><label class="f grow">${t("amount")}<input type="number" id="eAmt" inputmode="decimal" min="0" step="0.01"></label>
        <label class="f grow">${t("paidBy")}<select id="ePay">${nm.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join("")}</select></label></div>
        <label class="f">${t("split")}<select id="eSplit"><option value="equal">${t("splitEqual")}</option><option value="full">${t("splitFull")}</option></select></label>
        <button class="btn red block" id="eAdd">${t("addExpense")}</button></div>
      <div class="card">${S.expenses.length ? S.expenses.slice().reverse().map((e) => `<div class="exp"><div class="grow"><b>${esc(e.desc || "—")}</b><div class="muted" style="font-size:12px">${esc(nm[e.payer])} · ${e.split === "full" ? t("splitFull") : t("splitEqual")} · ${new Date(e.at).toLocaleDateString(S.lang === "he" ? "he-IL" : "en-GB")}</div></div><div class="amt">£${e.gbp.toFixed(2)}<div class="muted" style="font-size:11px;font-weight:600">${ils(e.gbp)}</div></div><button class="x" data-x="${e.id}" aria-label="${t("delete")}">✕</button></div>`).join("") : `<div class="muted">—</div>`}</div>
      <div class="card"><div class="lbl">${t("names")}</div><div class="row"><input type="text" id="n0" value="${esc(nm[0])}"><input type="text" id="n1" value="${esc(nm[1])}"></div>
        <div class="lbl" style="margin-top:10px">${t("rate")} (₪)</div><input type="number" id="rateIn" step="0.01" value="${S.rate || ""}" placeholder="${(RATE?.v || 4.5).toFixed(3)}"></div>`;
    $("#eAdd").onclick = () => {
      const gbp = parseFloat($("#eAmt").value);
      if (!(gbp > 0)) { $("#eAmt").focus(); return; }
      S.expenses.push({ id: Date.now().toString(36), desc: $("#eDesc").value.trim(), gbp, payer: +$("#ePay").value, split: $("#eSplit").value, at: Date.now() });
      save(); renderMoney(); toast(t("saved"));
    };
    $$("[data-x]").forEach((b) => (b.onclick = () => { S.expenses = S.expenses.filter((e) => e.id !== b.dataset.x); save(); renderMoney(); }));
    $("#n0").onchange = $("#n1").onchange = () => { S.names = [$("#n0").value.trim() || nm[0], $("#n1").value.trim() || nm[1]]; save(); renderMoney(); };
    $("#rateIn").onchange = (e) => { S.rate = parseFloat(e.target.value) || null; if (S.rate) RATE = null; save(); renderMoney(); };
  }

  /* ================= info tab ================= */
  function renderInfo() {
    const fl = FLIGHTS.map((f) => `<div class="card"><div class="row" style="justify-content:space-between"><span class="code px">✈ ${f.code} · ${fmtDate(f.date)}</span><span class="pill" style="font-size:12px">${t("copyRef")}: <b>${f.ref}</b></span></div>
      <div class="flight" style="margin-top:10px"><div><div class="big">${f.dep}</div><div class="px">${f.from}</div><div class="muted" style="font-size:12px">${esc(tr(f.fromCity))}</div></div><div class="plane">✈</div><div><div class="big">${f.arr}</div><div class="px">${f.to}</div><div class="muted" style="font-size:12px">${esc(tr(f.toCity))}</div></div></div>
      <div class="muted" style="font-size:12px;margin-top:6px;text-align:center">${f.cabin}${f.duration ? " · " + f.duration : ""} · ${S.lang === "he" ? "שעון מקומי" : "local time"}</div></div>`).join("");
    const pk = PACKING.map((x, i) => `<label class="chk ${S.packing[i] ? "done" : ""}"><input type="checkbox" data-pk="${i}" ${S.packing[i] ? "checked" : ""}><span>${esc(tr(x))}</span></label>`).join("");
    const around = S.lang === "he"
      ? ["משלמים בכל הרכבות והאוטובוסים עם כרטיס אשראי או טלפון contactless. כל אחד צריך כרטיס או טלפון משלו.", "יש תקרה יומית ושבועית אוטומטית: אין צורך בכרטיס יומי.", "קו אליזבת' (סגול) מהיר מהית'רו למרכז.", "אוטובוס: רק contactless, אין תשלום במזומן. נסיעה שנייה בתוך שעה חינם (Hopper).", "עומדים בצד ימין במדרגות נעות!"]
      : ["Pay on every train and bus with a contactless card or phone. Each person needs their own card or phone.", "Daily and weekly caps apply automatically: no need for a day pass.", "The Elizabeth line (purple) is the fast way from Heathrow to the centre.", "Buses are contactless only, no cash. A second bus within an hour is free (Hopper).", "Stand on the right on escalators!"];
    $("#view").innerHTML = `
      <h2 style="color:#fff;margin:6px 0 12px">✈ ${t("flights")}</h2>${fl}
      <h2 style="color:#fff;margin:18px 0 12px">🚆 ${t("transfers")}</h2>
      <div class="card"><b>${t("airportTransfer")}</b><p style="margin:6px 0 10px;line-height:1.5">${t("byElizabeth")}</p>
        <div class="row wrap"><a class="btn small blue" href="https://tfl.gov.uk/plan-a-journey/" target="_blank" rel="noopener">TfL Journey Planner ↗</a>${S.home.lat ? `<a class="btn small" href="https://www.google.com/maps/dir/?api=1&origin=51.4723,-0.488&destination=${S.home.lat},${S.home.lng}&travelmode=transit" target="_blank" rel="noopener">LHR → 🏠 ↗</a>` : ""}</div></div>
      <h2 style="color:#fff;margin:18px 0 12px">🛏 ${t("stay")}</h2>
      <div class="card"><b><bdi dir="ltr">${esc(TRIP.home.address)}</bdi></b>${S.home.label ? `<div class="muted" style="font-size:12px;margin-top:4px">📍 <bdi dir="ltr">${esc(S.home.label)}</bdi></div>` : `<div class="warn" style="margin-top:8px">${t("setHome")}</div>`}
        <label class="f">${t("homeAddr")}<div class="row"><input type="text" id="homeIn" placeholder="6 Park Avenue, London NW…" value="${esc(S.home.query || "")}"><button class="btn small red" id="homeFind">${t("findHome")}</button></div></label></div>
      <h2 style="color:#fff;margin:18px 0 12px">🚇 ${t("getAround")}</h2>
      <div class="card"><ul class="dots">${around.map((x) => `<li>${x}</li>`).join("")}</ul><div class="lbl" style="margin-top:12px">${t("lineStatus")} · TfL live</div><div id="allStatus" class="muted">${t("liveLoading")}</div></div>
      <h2 style="color:#fff;margin:18px 0 12px">🔔 ${t("alerts")}</h2>
      <div class="card"><p style="margin:0 0 10px;font-size:14px;line-height:1.45">${t("alertsNote")}</p>
        <div class="row wrap"><button class="btn small ${S.alerts ? "yellow" : "red"}" id="alertBtn">${S.alerts ? "🔔 " + t("alertsOn") : t("alertsOff")}</button><button class="btn small" id="testAlert">${t("testAlert")}</button></div>
        <div id="nextAl" class="muted" style="margin-top:8px;font-size:13px"></div></div>
      <div class="card"><div class="row wrap"><button class="btn yellow grow" id="icsBtn">📅 ${t("exportIcs")}</button><a class="btn grow" href="#/summary">📒 ${t("summary")}</a></div><div class="muted" style="font-size:12px;margin-top:8px">${t("calNote")}</div></div>
      <h2 style="color:#fff;margin:18px 0 12px">🎒 ${t("packing")}</h2><div class="card">${pk}</div>
      <div class="card" style="font-size:12px;line-height:1.5" class="muted">Weather: Open-Meteo · Live trains: TfL Unified API (Powered by TfL Open Data) · Map: © OpenStreetMap · Photos: Wikimedia Commons (credited per photo) · FX: open.er-api.com</div>`;
    $$("[data-pk]").forEach((c) => (c.onchange = () => { S.packing[c.dataset.pk] = c.checked; save(); c.closest(".chk").classList.toggle("done", c.checked); }));
    $("#homeFind").onclick = findHome;
    $("#icsBtn").onclick = exportIcs;
    $("#alertBtn").onclick = toggleAlerts;
    $("#testAlert").onclick = () => notify("🔔 London", S.lang === "he" ? "ככה תיראה התראת יציאה" : "This is what a leave-now alert looks like");
    const na = nextAlert(); $("#nextAl").textContent = na ? `${t("nextAlert")}: ${na.at} → ${tr(na.p.name)}` : "";
    lineStatus().then((all) => { $("#allStatus").classList.remove("muted"); $("#allStatus").innerHTML = all.map(statusRow).join(""); }).catch(() => ($("#allStatus").textContent = t("liveErr")));
  }
  async function findHome() {
    const q = $("#homeIn").value.trim() || TRIP.home.address;
    try {
      const j = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(q)}`, { headers: { "Accept-Language": "en" } })).json();
      if (!j[0]) { toast("?"); return; }
      S.home = { ...S.home, lat: +j[0].lat, lng: +j[0].lon, label: j[0].display_name, query: q }; save();
      toast(t("homeSet")); renderInfo();
    } catch { toast(t("liveErr")); }
  }

  /* ================= .ics export ================= */
  function exportIcs() {
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const icsEsc = (s) => String(s).replace(/\\/g, "\\\\").replace(/[,;]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
    const utc = (date, hm, off = "+00:00") => { const d = new Date(`${date}T${hm}:00${off}`); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`; };
    const ev = [];
    const push = (uid, s, e, title, loc, desc, url) => ev.push(["BEGIN:VEVENT", `UID:${uid}@london-trip`, `DTSTAMP:${stamp}`, `DTSTART:${s}`, `DTEND:${e}`, `SUMMARY:${icsEsc(title)}`, loc ? `LOCATION:${icsEsc(loc)}` : "", desc ? `DESCRIPTION:${icsEsc(desc)}` : "", url ? `URL:${url}` : "", "END:VEVENT"].filter(Boolean).join("\r\n"));
    FLIGHTS.forEach((f) => push(f.code + f.date, utc(f.date, f.dep, f.tz.dep), utc(f.date, f.arr, f.tz.arr), `✈ ${f.code} ${f.from} → ${f.to}`, f.from, `${t("copyRef")}: ${f.ref}`));
    // November in London = GMT (UTC+0)
    DAYS.forEach((d) => dayPlan(d).stops.forEach((s, i) => {
      const p = P[s.p]; const start = toMin(s.t); const end = start + durMin(p.duration === "—" ? "1h" : p.duration);
      if (/^(lhr)$/.test(p.id)) return; // flights already in
      const desc = [tr(p.summary), `${t("booking")}: ${tr(p.booking)}`, p.bookUrl || ""].filter(Boolean).join("\n");
      push(`${d.date}-${i}-${p.id}`, utc(d.date, s.t), utc(d.date, fmtMin(Math.min(end, 1439))), `${CATS[p.cat].icon} ${tr(s.label) || tr(p.name)}`, p.station ? `${tr(p.name)} (${p.station.name})` : tr(p.name), desc, p.bookUrl);
    }));
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//london-trip//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:London 20-24.11.2026", ...ev, "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    a.download = "london-trip-2026.ics"; document.body.appendChild(a); a.click(); a.remove();
    toast(`📅 ${ev.length}`);
  }

  /* ================= leave-now alerts ================= */
  let swReg = null;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then((r) => (swReg = r)).catch(() => {});
  async function notify(title, body) {
    if (!("Notification" in window)) { toast(body); return; }
    if (Notification.permission !== "granted") { const p = await Notification.requestPermission(); if (p !== "granted") { toast(body); return; } }
    try { const reg = swReg || (await navigator.serviceWorker?.ready); if (reg) { reg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "leave", renotify: true }); return; } } catch {}
    try { new Notification(title, { body }); } catch { toast(body); }
  }
  async function toggleAlerts() {
    if (!S.alerts && "Notification" in window && Notification.permission !== "granted") { const p = await Notification.requestPermission(); if (p !== "granted") { toast(t("nearErr").split(".")[0]); } }
    S.alerts = !S.alerts; save(); renderInfo();
  }
  function legsToday() {
    const now = londonNow(); const d = DAYS.find((x) => x.date === now.date); if (!d) return [];
    const st = dayPlan(d).stops; const out = [];
    st.forEach((s, i) => { const n = st[i + 1]; if (!n) return; const l = leg(P[s.p], P[n.p]); if (!l || l.mode === "none") return; out.push({ key: `${d.date}-${i}`, leave: toMin(n.t) - l.min - 5, l, p: P[n.p] }); });
    return out;
  }
  function nextAlert() { const now = londonNow(); const x = legsToday().find((a) => a.leave >= now.mins); return x ? { at: fmtMin(x.leave), p: x.p } : null; }
  function alertTick() {
    if (!S.alerts) return;
    const now = londonNow();
    legsToday().forEach((a) => {
      if (now.mins >= a.leave && now.mins <= a.leave + 3 && !S.notified[a.key]) {
        S.notified[a.key] = 1; save();
        notify(S.lang === "he" ? `🚶 הגיע הזמן לצאת: ${tr(a.p.name)}` : `🚶 Time to leave for ${tr(a.p.name)}`, `${a.l.mode === "walk" ? t("walk") : t("transit")} ≈${a.l.min} ${t("min")}${a.p.station ? " · " + a.p.station.name : ""}`);
      }
    });
  }
  setInterval(alertTick, 30e3);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) alertTick(); });

  /* ================= Ask (Claude via /api/ask) ================= */
  function openAsk() {
    const m = $("#modal");
    m.innerHTML = `<div class="box" role="dialog" aria-label="${t("askTitle")}"><div class="row" style="margin-bottom:10px"><h2 class="grow">💬 ${t("askTitle")}</h2><button class="round" id="askClose" style="width:38px;height:38px">✕</button></div>
      <textarea id="askQ" placeholder="${t("askPh")}"></textarea>
      <label class="chk" style="border:0"><input type="checkbox" id="askLoc" checked> ${t("useLoc")}</label>
      <button class="btn red block" id="askGo">${t("askSend")}</button><div id="askA"></div></div>`;
    m.classList.remove("hidden");
    $("#askClose").onclick = () => m.classList.add("hidden");
    m.onclick = (e) => { if (e.target === m) m.classList.add("hidden"); };
    $("#askGo").onclick = async () => {
      const q = $("#askQ").value.trim(); if (!q) return;
      const out = $("#askA"); out.innerHTML = `<div class="answer muted">${t("asking")}</div>`;
      let loc = null;
      if ($("#askLoc").checked && navigator.geolocation) loc = await new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res([+p.coords.latitude.toFixed(4), +p.coords.longitude.toFixed(4)]), () => res(null), { timeout: 8000, maximumAge: 120000 }));
      const now = londonNow();
      const d = DAYS.find((x) => x.date === now.date);
      const ctx = {
        lang: S.lang, londonNow: `${now.date} ${fmtMin(now.mins)}`, myLocation: loc,
        weatherToday: WX?.[now.date] || null, forecast: WX,
        todayPlan: d ? dayPlan(d).stops.map((s) => `${s.t} ${P[s.p].name.en}`) : null,
        places: PLACES.filter((p) => p.lat).map((p) => ({ name: p.name.en, cat: p.cat, area: p.area.en, lat: p.lat, lng: p.lng, hours: p.hoursText.en, openNow: isOpen(p), distKm: loc ? +km(loc, [p.lat, p.lng]).toFixed(2) : undefined })),
      };
      try {
        const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, context: ctx }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.status);
        out.innerHTML = `<div class="answer">${esc(j.answer)}</div>`;
      } catch (e) { out.innerHTML = `<div class="answer">${t("askErr")}<br><small class="muted">${esc(e.message)}</small></div>`; }
    };
    setTimeout(() => $("#askQ").focus(), 50);
  }
  $("#fab").onclick = openAsk;

  /* ================= summary ================= */
  async function openSummary() {
    const sh = $("#sheet");
    const all = await photosFor(null);
    const by = {}; all.forEach((x) => (by[x.pid] = by[x.pid] || []).push(x));
    const total = S.expenses.reduce((a, e) => a + e.gbp, 0);
    const rate = RATE?.v || S.rate || 4.5;
    let any = false;
    const daysHtml = DAYS.map((d, i) => {
      const items = dayPlan(d).stops.filter((s, j, arr) => arr.findIndex((x) => x.p === s.p) === j).filter((s) => S.visited[s.p] || S.notes[s.p] || by[s.p]);
      if (!items.length) return "";
      any = true;
      return `<div class="card sumday" style="--dc:${d.color}"><h3>${t("day")} ${i + 1} · ${fmtDate(d.date, true)}</h3><div class="muted" style="font-weight:700">${esc(tr(dayPlan(d).title))}</div>
        ${items.map((s) => { const p = P[s.p]; return `<div class="sumstop"><b>${CATS[p.cat].icon} ${esc(tr(p.name))}</b> <span class="muted px">${s.t}</span>${S.notes[s.p] ? `<div style="margin-top:4px;line-height:1.45">“${esc(S.notes[s.p])}”</div>` : ""}${by[s.p] ? `<div class="photos">${by[s.p].map((x) => `<div class="p"><img src="${URL.createObjectURL(x.blob)}" alt=""></div>`).join("")}</div>` : ""}</div>`; }).join("")}</div>`;
    }).join("");
    const extra = PLACES.filter((p) => !allPlanned()[p.id] && (S.visited[p.id] || S.notes[p.id] || by[p.id]));
    sh.innerHTML = `<div class="in"><div class="top"><button class="round" id="backBtn">${S.lang === "he" ? "→" : "←"}</button><span class="badge">${t("summary")}</span><button class="round" id="printBtn" aria-label="${t("print")}">🖨</button></div>
      <div class="hdr" style="margin-bottom:14px"><div><div class="logo">LONDON</div><div class="sub"><bdi dir="ltr">20–24.11.2026</bdi> · ${esc(names().join(" & "))}</div></div></div>
      <div class="facts"><div class="fact"><div class="lbl">${t("stops")}</div><span style="font-size:26px;font-weight:900">${Object.values(S.visited).filter(Boolean).length}</span></div><div class="fact"><div class="lbl">${t("photos")}</div><span style="font-size:26px;font-weight:900">${all.length}</span></div><div class="fact wide"><div class="lbl">${t("spent")}</div><span style="font-size:22px;font-weight:900">£${total.toFixed(2)}</span> · ₪${Math.round(total * rate).toLocaleString()}</div></div>
      ${daysHtml}
      ${extra.length ? `<div class="card"><h3>★ ${t("wishlist")}</h3>${extra.map((p) => `<div class="sumstop"><b>${esc(tr(p.name))}</b>${S.notes[p.id] ? `<div>“${esc(S.notes[p.id])}”</div>` : ""}${by[p.id] ? `<div class="photos">${by[p.id].map((x) => `<div class="p"><img src="${URL.createObjectURL(x.blob)}" alt=""></div>`).join("")}</div>` : ""}</div>`).join("")}</div>` : ""}
      ${!any && !extra.length ? `<div class="card">${t("sumEmpty")}</div>` : ""}</div>`;
    sh.classList.remove("hidden"); document.body.style.overflow = "hidden"; sh.scrollTop = 0;
    $("#backBtn").onclick = goBack;
    $("#printBtn").onclick = () => window.print();
  }

  /* ================= boot ================= */
  if (TRIP.home.lat && S.home.lat !== TRIP.home.lat && !S.home.query) { S.home = { ...TRIP.home }; save(); }
  applyTheme(); applyLang();
  renderAll();
  Promise.allSettled([loadWeather().then(() => { if (!WX) WX = undefined; }), loadImages(), loadRate()]).then(() => { if (WX === null) WX = undefined; const r = route(); if (!(r.raw[0] === "p" || r.raw[0] === "summary") && r.tab !== "map") renderAll(); else if (r.raw[0] === "p") renderAll(); });
  if (TRIP.home.lat && S.home.lat !== TRIP.home.lat && !S.home.query) { S.home = { ...TRIP.home }; save(); }
  alertTick();
  window.__trip = { S, londonNow, flexAssign, dayPlan };
})();
