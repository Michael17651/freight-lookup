// Pure lookup logic shared by the app and the tests. No network calls here.

// "8701" (leading zero lost in Excel), "08701-1234", " 08701 " -> "08701". Anything else -> null.
export function cleanZip(input) {
  const m = String(input ?? "").trim().match(/^(\d{4,5})(?:-\d{4})?$/);
  return m ? m[1].padStart(5, "0") : null;
}

// Returns [{ name, zone }] where zone is a number or null (service not available),
// or null when the ZIP is not in the chart at all.
export function zonesFor(zip, zones) {
  const row = zones.zip5[zip] ?? zones.prefix[zip.slice(0, 3)];
  return row ? zones.services.map((name, i) => ({ name, zone: row[i] })) : null;
}

// Map of ZIP -> list names, built once from surcharge.json.
export function indexSurcharge(surcharge) {
  const index = new Map();
  for (const [name, zips] of Object.entries(surcharge.lists)) {
    for (const z of zips) index.set(z, [...(index.get(z) ?? []), name]);
  }
  return index;
}

// [] means "Not rural".
export function surchargeFor(zip, index) {
  return index.get(zip) ?? [];
}
