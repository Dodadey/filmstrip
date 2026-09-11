# Filmstrip

Rank four films at a time. Elo does the rest, and a top 100 falls out.

## Deploy

1. Make a new GitHub repo called `filmstrip`.
2. Drop every file in this folder into the root of it (not in a subfolder).
3. Repo → Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
4. Wait a minute. It appears at `https://<your-username>.github.io/filmstrip/`.

## Put it on the iPhone

Open that URL in **Safari** (not Chrome — only Safari can install to the home
screen on iOS). Share button → Add to Home Screen. You get an icon that opens
without browser chrome.

## Fill the pool

Run `build_pool.py` on the Mac, then in the app: Pool → Choose a CSV file →
`filmstrip_pool.csv`. Then `filmstrip_watchlist.csv` if the script made one.

Reset to seed pool first if the 97 starter films are still in there — imports
skip titles already present, so the starters would block their genre-and-poster
carrying replacements.

The iPhone can't reach files on the Mac. Either AirDrop the CSVs across and save
them to Files, or just do the import once on the Mac — but note the pool lives
in browser storage per device, so **the Mac and the iPhone keep separate pools**.
Import on whichever device you'll actually rank on, or use Export/Restore to move
a pool between them.

## Backups

Everything lives in this browser's `localStorage`. Safari clears site data for
sites you haven't opened in a while — adding to the home screen makes that much
less likely, but not impossible. Once you've put real hours in, hit Pool →
Export and keep the JSON somewhere. Restore takes it back.

## Files

| file | what it is |
|---|---|
| `index.html` | shell, iOS meta tags, safe-area padding |
| `app.js` | the whole app, React bundled in (164kb) |
| `src/App.jsx` | readable source — edit this, then rebuild |
| `src/main.jsx` | mount point and service worker registration |
| `sw.js` | offline cache: app shell, plus posters as you meet them |
| `manifest.webmanifest` | name, icons, standalone display |
| `icon-192.png`, `icon-512.png` | home screen icons |

## Rebuilding after an edit

```
npm install esbuild react react-dom
npx esbuild src/main.jsx --bundle --minify --format=iife --target=es2020 \
  --loader:.jsx=jsx --jsx=automatic --outfile=app.js
```

Bump the `SHELL` cache name in `sw.js` when you redeploy, otherwise the service
worker keeps serving the old `app.js`.

## How the ranking works

Each round of four is six pairwise results. Elo updates all six at once, with
K=32 under 10 comparisons, 24 under 25, then 16.

Films sit in one of four tiers:

- **intake** — under 3 comparisons, brand new
- **contenders** — the main field
- **top table** — the top 15%, matched only against each other once there are
  40+ rated films. This is where the top 100 gets its precision.
- **archive** — 8+ comparisons and under 1400 Elo. Sampled rarely, so a film can
  climb back out. Nothing is ever deleted.

Charts need 8 comparisons before a film counts as confirmed. Genre charts are
the global Elo filtered by genre, not separate per-genre ratings.
