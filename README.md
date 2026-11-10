# Freight lookup

A one-page web app for looking up a US customer address. It shows:

1. Residential or Commercial (from Smarty's RDI field)
2. UPS rural (area) surcharge status
3. The UPS zone for every service, for shipments from ZIP 088xx

There is also a "ZIP only" mode that shows zone and rural status with no address check and no API calls.

Live site: https://michael17651.github.io/freight-lookup/

## How it is built

- `site/` is the whole website. It is plain HTML, CSS and JavaScript with no build step.
- `site/data/zones.json` and `site/data/surcharge.json` are made from the UPS spreadsheets by `build_data.py`.
- `site/config.js` holds the Smarty embedded key.
- Pushing to `main` publishes `site/` to GitHub Pages through `.github/workflows/pages.yml`.

## When UPS sends new files

1. Save the new files into `data/`, replacing the old ones (keep the names `ups-zones-088.xlsx` and `area-surcharge-zips-us-en.xlsx`), or pass the paths to the script.
2. Run:

   ```bash
   .venv/bin/python build_data.py
   ```

   First time on a new computer, create the Python environment:

   ```bash
   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
   ```

3. The script prints how many ZIP prefixes and surcharge ZIPs it found. If the layout of a UPS file changed, it stops with an error instead of writing bad data.
4. Run the tests, then commit and push. The site updates in about a minute.

   ```bash
   .venv/bin/python -m unittest discover tests && node --test tests/
   ```

The zone file must be an `.xlsx` file. If UPS sends an old `.xls`, open it in Excel or Numbers and save it as `.xlsx` first.

## Set up Smarty (address suggestions and Residential/Commercial)

Address search needs a Smarty account and an embedded key. Until the key is added, the Address tab shows a notice and the ZIP only tab still works.

1. Go to https://www.smarty.com and choose "Sign up" or "Start free trial". Use your work email. The free trial needs no card at the time of writing, but read the sign-up page to confirm.
2. Confirm your email and sign in.
3. Open your account, then "API Keys".
4. In the "Embedded Keys" section, choose "Create new embedded key".
5. Under the allowed hosts (sometimes called "Referer hosts"), add:
   - `michael17651.github.io` (the live site)
   - `localhost` (only if you want to test on your own computer)
6. Save. Copy the key. It is a long string of letters and numbers.
7. Open `site/config.js` and paste it between the quotes:

   ```js
   smartyKey: "YOUR-KEY-HERE",
   ```

8. Commit and push. Within a minute the live site uses the key.

Why this is safe: an embedded key only works when the request comes from a website on its allowed-hosts list. Someone who copies it cannot use it from their own site. Never put a Smarty "secret key" (auth-id and auth-token) in this project.

The app makes about one autocomplete lookup per pause in typing and one verification per chosen address. Check your lookup counts in the Smarty dashboard before the trial ends and pick a plan that covers US Autocomplete and US Street.

## Running the site on your computer

```bash
python3 -m http.server 8765 --directory site
```

Then open http://localhost:8765. Address search only works locally if `localhost` is on the key's allowed hosts.

## Tests

- `tests/test_build.py` checks how the build script reads ZIP prefixes, ranges like `004-007`, and "-" zones.
- `tests/lookup.test.mjs` checks the real built data: leading-zero ZIPs, a "-" service, Hawaii and Alaska ZIPs, a DAS ZIP, an Extended ZIP, the Remote lists and a "Not rural" ZIP.
