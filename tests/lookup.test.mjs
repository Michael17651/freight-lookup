// Run: node --test tests/   (uses the JSON built by build_data.py)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanZip, zonesFor, indexSurcharge, surchargeFor } from "../site/lookup.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../site/data/${f}`, import.meta.url)));
const zones = load("zones.json");
const index = indexSurcharge(load("surcharge.json"));
const zoneMap = (zip) => Object.fromEntries(zonesFor(zip, zones).map((s) => [s.name, s.zone]));

test("cleanZip restores leading zeros and drops ZIP+4", () => {
  assert.equal(cleanZip("1002"), "01002");
  assert.equal(cleanZip("01002-1234"), "01002");
  assert.equal(cleanZip(" 08701 "), "08701");
  assert.equal(cleanZip("abc"), null);
  assert.equal(cleanZip("12"), null);
  assert.equal(cleanZip("087"), null);
});

test("zone for a leading-zero ZIP (005xx)", () => {
  assert.deepEqual(zoneMap("00501"), {
    Ground: 2, "3 Day Select": 302, "2nd Day Air": 202,
    "2nd Day Air A.M.": 242, "Next Day Air Saver": 132, "Next Day Air": 102,
  });
});

test('a "-" service comes back as null (not available)', () => {
  const z = zoneMap("00601"); // Puerto Rico
  assert.equal(z.Ground, 45);
  assert.equal(z["3 Day Select"], null);
  assert.equal(z["Next Day Air"], 125);
});

test("Hawaii and Alaska use the 5-digit footnote lists", () => {
  assert.equal(zoneMap("96701").Ground, 44);
  assert.equal(zoneMap("96703").Ground, 46);
  assert.equal(zoneMap("99529")["2nd Day Air"], 226);
});

test("unknown ZIP prefix returns null", () => {
  assert.equal(zonesFor("00100", zones), null);
});

test("DAS ZIP with a leading zero", () => {
  assert.deepEqual(surchargeFor("01002", index), ["US 48 Zip (DAS)"]);
});

test("DAS Extended ZIP", () => {
  assert.deepEqual(surchargeFor("01005", index), ["US 48 Zip DAS Extended"]);
});

test("Remote lists", () => {
  assert.deepEqual(surchargeFor("01026", index), ["Remote US 48"]);
  assert.deepEqual(surchargeFor("96703", index), ["Remote HI"]);
  assert.deepEqual(surchargeFor("99540", index), ["Remote AK"]);
});

test("Not rural", () => {
  assert.deepEqual(surchargeFor("08701", index), []);
});
