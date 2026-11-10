import { cleanZip, zonesFor, indexSurcharge, surchargeFor, readyToSuggest } from "./lookup.js";

const KEY = (window.FREIGHT_CONFIG?.smartyKey || "").trim();
const AUTOCOMPLETE = {
  v2: "https://us-autocomplete.api.smarty.com/v2/lookup",
  pro: "https://us-autocomplete-pro.api.smarty.com/lookup",
};
const STREET = "https://us-street.api.smarty.com/street-address";
const RECENT_KEY = "freight-lookup-recent";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let zones, surcharge;
try {
  [zones, surcharge] = await Promise.all(
    ["data/zones.json", "data/surcharge.json"].map((f) => fetch(f).then((r) => {
      if (!r.ok) throw new Error(f);
      return r.json();
    })),
  );
} catch {
  $("status").innerHTML = `<div class="msg error">The UPS data did not load. Refresh the page. If it keeps happening, tell Michael.</div>`;
  throw new Error("data load failed");
}
const surIndex = indexSurcharge(surcharge);
$("footer").textContent =
  `Zones for shipments from ZIP ${zones.origin}xx. Area surcharge lists effective ${surcharge.effective}.`;

// ---------- Tabs ----------
function showTab(zipMode) {
  cancelPending();
  $("tab-address").setAttribute("aria-selected", !zipMode);
  $("tab-zip").setAttribute("aria-selected", zipMode);
  $("address-form").hidden = zipMode;
  $("zip-form").hidden = !zipMode;
  clearOutput();
  (zipMode ? $("zip") : $("address")).focus();
  if (!zipMode && !KEY) setStatus("info", "Address search is not set up yet (no Smarty key in config.js). Use ZIP only.");
}
$("tab-address").onclick = () => showTab(false);
$("tab-zip").onclick = () => showTab(true);

// ---------- Messages and results ----------
function setStatus(kind, text) {
  $("status").innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : "";
}
function clearOutput() {
  setStatus();
  $("results").innerHTML = "";
}

const RURAL_COLOR = (name) => (/Extended/.test(name) ? "orange" : /Remote/.test(name) ? "red" : "amber");

function render({ zip, rdi, address }) {
  const services = zonesFor(zip, zones);
  const lists = surchargeFor(zip, surIndex);
  let html = "";

  if (address) {
    html += `<div class="card addr">
      <div><div class="label">Standardized address</div><div class="text">${esc(address.line1)}<br>${esc(address.last)}</div></div>
      <button class="copy" type="button">Copy</button></div>`;
  }

  html += `<div class="pair">`;
  if (rdi !== undefined) {
    const color = rdi === "Commercial" ? "blue" : rdi === "Residential" ? "amber" : "grey";
    html += `<div class="card ${color}"><div class="label">Address type</div>
      <div class="big">${esc(rdi || "Unknown")}</div>
      ${rdi ? "" : `<div class="sub">Smarty could not tell for this address.</div>`}</div>`;
  }
  html += lists.length
    ? `<div class="card ${RURAL_COLOR(lists[0])}"><div class="label">Rural surcharge</div>
        <div class="big">Yes</div><div class="sub">On list: ${lists.map(esc).join(", ")}</div></div>`
    : `<div class="card green"><div class="label">Rural surcharge</div><div class="big">Not rural</div>
        <div class="sub">ZIP ${esc(zip)} is on no area surcharge list.</div></div>`;
  html += `</div>`;

  html += services
    ? `<div class="card"><div class="label">UPS zones from ${esc(zones.origin)} to ${esc(zip)}</div>
        <table class="zones">${services
          .map((s) => `<tr><td>${esc(s.name)}</td><td>${s.zone == null ? `<span class="na">Not available</span>` : s.zone}</td></tr>`)
          .join("")}</table></div>`
    : `<div class="card red"><div class="label">UPS zones</div><div class="big">Not in chart</div>
        <div class="sub">ZIP ${esc(zip)} is not in the UPS zone chart. It may be a US territory or an invalid ZIP.</div></div>`;

  $("results").innerHTML = html;
  const copy = $("results").querySelector(".copy");
  if (copy) copy.onclick = () => copyText(`${address.line1}\n${address.last}`, copy);
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => (button.textContent = "Copy"), 1500);
}

// ---------- Recent lookups (this browser only) ----------
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}
function saveRecent(entry) {
  const label = entry.address ? `${entry.address.line1}, ${entry.address.last}` : `ZIP ${entry.zip}`;
  const list = [{ ...entry, label }, ...loadRecent().filter((e) => e.label !== label)].slice(0, 10);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private mode: skip */ }
  drawRecent();
}
function drawRecent() {
  const list = loadRecent();
  $("recent-section").hidden = !list.length;
  $("recent").innerHTML = list
    .map((e, i) => `<li><button data-i="${i}">${esc(e.label)}${e.rdi ? ` <small>${esc(e.rdi)}</small>` : ""}</button></li>`)
    .join("");
}
$("recent").onclick = (ev) => {
  const b = ev.target.closest("button[data-i]");
  if (!b) return;
  cancelPending();
  setStatus();
  render(loadRecent()[b.dataset.i]); // zones and rural status are recomputed from the current data; no API call
};
$("clear-recent").onclick = () => {
  try { localStorage.removeItem(RECENT_KEY); } catch {}
  drawRecent();
};
drawRecent();

// ---------- ZIP only mode (no API calls) ----------
$("zip-form").onsubmit = (ev) => {
  ev.preventDefault();
  const zip = cleanZip($("zip").value);
  cancelPending();
  if (!zip) return clearOutput(), setStatus("error", "Enter a 5-digit ZIP code, for example 08701.");
  setStatus();
  const entry = { zip };
  render(entry);
  saveRecent(entry);
};

// ---------- Smarty calls ----------
function smartyError(status) {
  return {
    401: "Smarty rejected the key. Check the key in config.js and the website addresses allowed on it.",
    402: "The Smarty subscription is not active.",
    429: "Too many address lookups right now. Wait a minute and try again.",
  }[status] || `Smarty returned an error (${status}).`;
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("Can't reach the address service. Check the internet connection.");
  }
  if (!res.ok) throw Object.assign(new Error(smartyError(res.status)), { status: res.status });
  return res.json();
}

let api = "v2"; // switches to "pro" for this visit if the v2 endpoint fails
async function suggest(search, selected) {
  const params = new URLSearchParams({ key: KEY, max_results: "10" });
  if (search) params.set("search", search.slice(0, 32));
  if (selected) params.set("selected", selected);
  try {
    return (await getJson(`${AUTOCOMPLETE[api]}?${params}`)).suggestions || [];
  } catch (e) {
    // Try Pro only when v2 itself is refused (not for network blips, billing or rate limits).
    if (api !== "v2" || ![400, 401, 403, 404].includes(e.status)) throw e;
    if (selected) params.set("selected", expand.proSelected);
    params.set("search", input.value.slice(0, 32)); // Pro always needs search
    const list = (await getJson(`${AUTOCOMPLETE.pro}?${params}`)).suggestions || [];
    api = "pro"; // Pro worked, so keep using it for this visit
    return list;
  }
}

async function verify(fields) {
  const params = new URLSearchParams({ key: KEY, candidates: "1", match: "strict", ...fields });
  const [hit] = await getJson(`${STREET}?${params}`);
  if (!hit) throw new Error("Address not found. Check the street number, street name and ZIP, then try again.");
  const c = hit.components || {};
  return {
    zip: c.zipcode,
    rdi: hit.metadata?.rdi || "",
    address: {
      line1: [hit.delivery_line_1, hit.delivery_line_2].filter(Boolean).join(", "),
      last: c.plus4_code ? `${c.city_name} ${c.state_abbreviation} ${c.zipcode}-${c.plus4_code}` : hit.last_line,
    },
  };
}

// ---------- Address autocomplete ----------
const input = $("address");
const box = $("suggestions");
let timer, requestNo = 0, lookupNo = 0, current = [], expand = null;

// Drop any typing timer, suggestion request or address check still in flight.
function cancelPending() {
  clearTimeout(timer);
  requestNo++;
  lookupNo++;
}

function hideSuggestions() {
  box.hidden = true;
  box.innerHTML = "";
  input.setAttribute("aria-expanded", "false");
}

function showSuggestions(list) {
  current = list;
  if (!list.length) {
    hideSuggestions();
    setStatus("info", "No matching addresses. Check the house number and street name.");
    return;
  }
  setStatus();
  box.innerHTML = list
    .map((s, i) => {
      const unit = s.secondary ? ` ${s.secondary}` : "";
      const more = s.entries > 1 ? ` <span class="more">(${s.entries} units)</span>` : "";
      return `<li role="option"><button type="button" data-i="${i}">${esc(`${s.street_line}${unit}, ${s.city} ${s.state} ${s.zipcode}`)}${more}</button></li>`;
    })
    .join("");
  box.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

const cache = new Map(); // request -> suggestions, for this visit only
let shownKey = "";

function updateHint() {
  $("address-hint").textContent = expand || readyToSuggest(input.value)
    ? "Pick an address from the list."
    : "Type the house number and street name, e.g. 123 Main";
}

async function runSuggest() {
  const value = input.value.trim().replace(/\s+/g, " ");
  if (expand && !input.value.startsWith(expand.text)) expand = null;
  updateHint();
  if (!expand && !readyToSuggest(value)) return (hideSuggestions(), (shownKey = ""));
  // v2 unit lists: send only the entry id until she types past the building text.
  const search = expand && api === "v2" && value === expand.text.trim() ? null : value;
  const selected = expand && (api === "v2" ? expand.entryId : expand.proSelected);
  const key = `${api}|${search}|${selected}`;
  if (key === shownKey && !box.hidden) return; // text unchanged: nothing to do
  const no = ++requestNo;
  try {
    if (!cache.has(key)) cache.set(key, await suggest(search, selected));
    if (no === requestNo) (showSuggestions(cache.get(key)), (shownKey = key));
  } catch (e) {
    if (no === requestNo) (hideSuggestions(), setStatus("error", e.message));
  }
}

input.addEventListener("input", () => {
  if (!KEY) return setStatus("info", "Address search is not set up yet (no Smarty key in config.js). Use ZIP only.");
  updateHint();
  clearTimeout(timer);
  timer = setTimeout(runSuggest, 500);
});

async function pick(s) {
  if (s.entries > 1) {
    // A building with many units: show its units next.
    const text = `${s.street_line} ${s.secondary}`.trim() + " ";
    expand = {
      text,
      entryId: s.entry_id,
      proSelected: `${s.street_line} ${s.secondary} (${s.entries}) ${s.city} ${s.state} ${s.zipcode}`,
    };
    input.value = text;
    input.focus();
    clearTimeout(timer);
    return runSuggest();
  }
  hideSuggestions();
  expand = null;
  input.value = `${s.street_line}${s.secondary ? " " + s.secondary : ""}, ${s.city} ${s.state} ${s.zipcode}`;
  await lookupAddress({ street: s.street_line, secondary: s.secondary || "", city: s.city, state: s.state, zipcode: s.zipcode });
}

async function lookupAddress(fields) {
  cancelPending();
  const no = lookupNo;
  clearOutput();
  setStatus("info", "Checking address...");
  try {
    const result = await verify(fields);
    if (no !== lookupNo) return; // a newer lookup started meanwhile
    setStatus();
    render(result);
    saveRecent(result);
  } catch (e) {
    if (no === lookupNo) setStatus("error", e.message);
  }
}

box.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-i]");
  if (b) pick(current[b.dataset.i]);
});

// Keyboard: Down arrow moves into the list, Up/Down moves within it, Escape closes it.
input.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown" && !box.hidden) (ev.preventDefault(), box.querySelector("button")?.focus());
  if (ev.key === "Escape") hideSuggestions();
});
box.addEventListener("keydown", (ev) => {
  const items = [...box.querySelectorAll("button")];
  const i = items.indexOf(document.activeElement);
  if (ev.key === "ArrowDown") (ev.preventDefault(), items[Math.min(i + 1, items.length - 1)]?.focus());
  if (ev.key === "ArrowUp") (ev.preventDefault(), i <= 0 ? input.focus() : items[i - 1].focus());
  if (ev.key === "Escape") (hideSuggestions(), input.focus());
});

// The address check runs only when she picks a suggestion, so Enter does nothing here.
$("address-form").onsubmit = (ev) => ev.preventDefault();

document.addEventListener("click", (ev) => {
  if (!$("address-form").contains(ev.target)) hideSuggestions();
});

if (!KEY) setStatus("info", "Address search is not set up yet (no Smarty key in config.js). Use ZIP only.");
