import React, { useState, useEffect, useMemo, useRef } from "react";

/* ============================================================
   FILMSTRIP — a four-up ranking engine
   Elo with promotion/relegation tiers, optional genre charts,
   and a watchlist that builds itself from "not seen" taps.
   ============================================================ */

const STORAGE_KEY = "filmstrip:v1";
const INTAKE_N = 3;          // one round's worth: a film leaves intake after its first strip
const CONFIRMED_N = 8;       // comparisons needed to leave "provisional"
const ARCHIVE_ELO = 1400;    // relegation floor
const BASE_ELO = 1500;

const kFor = (n) => (n < 10 ? 32 : n < 25 ? 24 : 16);

// Letterboxd half-star -> starting Elo. Fitted so 2★≈1440, 4.5★≈1650.
const eloFromStars = (r) => Math.round(1272 + 84 * r);

/* ---------- seed pool: [title, year, "Genre|Genre"] ---------- */
const SEED = [
  ["The Searchers",1956,"Western"],["Once Upon a Time in the West",1968,"Western"],
  ["Unforgiven",1992,"Western"],["The Good, the Bad and the Ugly",1966,"Western"],
  ["McCabe & Mrs. Miller",1971,"Western|Drama"],["Rio Bravo",1959,"Western"],
  ["No Country for Old Men",2007,"Western|Crime|Thriller"],
  ["Some Like It Hot",1959,"Comedy"],["Dr. Strangelove",1964,"Comedy|War"],
  ["Duck Soup",1933,"Comedy"],["Groundhog Day",1993,"Comedy|Romance"],
  ["Annie Hall",1977,"Comedy|Romance"],["The Big Lebowski",1998,"Comedy|Crime"],
  ["Playtime",1967,"Comedy"],["His Girl Friday",1940,"Comedy|Romance"],
  ["Tokyo Story",1953,"Drama"],["Persona",1966,"Drama"],["Wild Strawberries",1957,"Drama"],
  ["The Seventh Seal",1957,"Drama"],["Fanny and Alexander",1982,"Drama"],
  ["Barry Lyndon",1975,"Drama"],["There Will Be Blood",2007,"Drama"],
  ["Nashville",1975,"Drama|Musical"],["A Separation",2011,"Drama"],["Yi Yi",2000,"Drama"],
  ["Cries and Whispers",1972,"Drama"],["Jeanne Dielman",1975,"Drama"],
  ["Beau Travail",1999,"Drama"],["Do the Right Thing",1989,"Drama|Comedy"],
  ["My Life as a Dog",1985,"Drama|Comedy"],["Songs from the Second Floor",2000,"Drama|Comedy"],
  ["The Godfather",1972,"Crime|Drama"],["Goodfellas",1990,"Crime|Drama"],
  ["Chinatown",1974,"Crime|Noir|Mystery"],["Pulp Fiction",1994,"Crime|Drama"],
  ["Heat",1995,"Crime|Thriller"],["Le Samouraï",1967,"Crime|Noir"],["Rififi",1955,"Crime|Noir"],
  ["Double Indemnity",1944,"Noir|Crime"],["The Third Man",1949,"Noir|Thriller"],
  ["Sunset Boulevard",1950,"Noir|Drama"],["Touch of Evil",1958,"Noir|Crime"],
  ["Out of the Past",1947,"Noir|Crime"],
  ["2001: A Space Odyssey",1968,"Sci-Fi"],["Blade Runner",1982,"Sci-Fi|Noir"],
  ["Stalker",1979,"Sci-Fi|Drama"],["Solaris",1972,"Sci-Fi|Drama"],
  ["Alien",1979,"Sci-Fi|Horror"],["Metropolis",1927,"Sci-Fi|Drama"],
  ["Arrival",2016,"Sci-Fi|Drama"],["Children of Men",2006,"Sci-Fi|Thriller"],
  ["Under the Skin",2013,"Sci-Fi|Horror"],
  ["The Shining",1980,"Horror"],["Psycho",1960,"Horror|Thriller"],
  ["Rosemary's Baby",1968,"Horror"],["Night of the Living Dead",1968,"Horror"],
  ["Get Out",2017,"Horror|Thriller"],["Let the Right One In",2008,"Horror|Drama"],
  ["Vertigo",1958,"Thriller|Mystery|Romance"],["Rear Window",1954,"Thriller|Mystery"],
  ["North by Northwest",1959,"Thriller|Adventure"],["The Conversation",1974,"Thriller|Drama"],
  ["Zodiac",2007,"Thriller|Crime"],["Mulholland Drive",2001,"Thriller|Mystery"],
  ["Spirited Away",2001,"Animation|Fantasy"],["My Neighbor Totoro",1988,"Animation|Fantasy"],
  ["Grave of the Fireflies",1988,"Animation|War|Drama"],
  ["Fantastic Mr. Fox",2009,"Animation|Comedy"],["The Iron Giant",1999,"Animation|Sci-Fi"],
  ["Perfect Blue",1997,"Animation|Thriller"],
  ["Singin' in the Rain",1952,"Musical|Comedy"],["The Umbrellas of Cherbourg",1964,"Musical|Romance"],
  ["West Side Story",1961,"Musical|Romance"],["A Hard Day's Night",1964,"Musical|Comedy"],
  ["All That Jazz",1979,"Musical|Drama"],
  ["Sans Soleil",1983,"Documentary"],["Shoah",1985,"Documentary"],
  ["Hoop Dreams",1994,"Documentary"],["Man with a Movie Camera",1929,"Documentary"],
  ["Apocalypse Now",1979,"War|Drama"],["Paths of Glory",1957,"War|Drama"],
  ["Come and See",1985,"War|Drama"],["The Battle of Algiers",1966,"War|Drama"],
  ["In the Mood for Love",2000,"Romance|Drama"],["Before Sunrise",1995,"Romance|Drama"],
  ["Casablanca",1942,"Romance|War|Drama"],["Brief Encounter",1945,"Romance|Drama"],
  ["8½",1963,"Drama|Comedy"],["La Dolce Vita",1960,"Drama"],["Bicycle Thieves",1948,"Drama"],
  ["The 400 Blows",1959,"Drama"],["Breathless",1960,"Crime|Drama"],
  ["Seven Samurai",1954,"Action|Drama"],["Rashomon",1950,"Crime|Drama"],
  ["Ikiru",1952,"Drama"],["Andrei Rublev",1966,"Drama"],
  ["Céline and Julie Go Boating",1974,"Fantasy|Comedy"],
];

const slug = (t, y) =>
  (t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + y);

const makeFilm = (title, year, genres, elo = BASE_ELO, seen = true, poster = "") => ({
  id: slug(title, year), title, year: year || null,
  genres: genres && genres.length ? genres : [],
  elo, n: 0, seen, poster,
});

// TMDB serves posters at a handful of fixed widths; w154 is the smallest that
// still looks sharp on a retina thumbnail.
const posterURL = (path) => `https://image.tmdb.org/t/p/w154${path}`;

const seedPool = () =>
  SEED.map(([t, y, g]) => makeFilm(t, y, g ? g.split("|") : []));

/* ---------- tiers ---------- */
function classify(films) {
  const active = films.filter((f) => f.seen !== false);
  const intake = active.filter((f) => f.n < INTAKE_N);
  const rated = active
    .filter((f) => f.n >= INTAKE_N)
    .sort((a, b) => b.elo - a.elo);
  // A top table only means anything once there's a real field behind it.
  // Before that, keeping it empty stops four early films becoming the
  // permanent yardstick for everything else.
  const topSize = rated.length >= 40
    ? Math.max(12, Math.min(150, Math.ceil(rated.length * 0.15)))
    : 0;
  const top = rated.slice(0, topSize);
  const rest = rated.slice(topSize);
  const archive = rest.filter((f) => f.n >= CONFIRMED_N && f.elo < ARCHIVE_ELO);
  const contenders = rest.filter((f) => !(f.n >= CONFIRMED_N && f.elo < ARCHIVE_ELO));
  return { active, intake, top, contenders, archive, topSize };
}

const shuffle = (a) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};

// weight toward films with the fewest comparisons
function pickAnchor(list) {
  const w = list.map((f) => 1 / (f.n + 1));
  const total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= w[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

function pickNear(list, targetElo, k, exclude = []) {
  const ex = new Set(exclude.map((f) => f.id));
  const cands = list.filter((f) => !ex.has(f.id));
  if (cands.length <= k) return shuffle(cands).slice(0, k);
  // The jitter matters more than it looks. Straight after an import every film
  // sits at exactly 1500, so sorting by distance sorts on identical keys and
  // hands back the same head of the list forever. 20 points is noise against a
  // 400-point scale, but it's enough to scatter ties.
  const scored = cands.map((f) => ({
    f, d: Math.abs(f.elo - targetElo) + Math.random() * 20,
  }));
  scored.sort((a, b) => a.d - b.d);
  return shuffle(scored.slice(0, Math.max(k, 14)).map((s) => s.f)).slice(0, k);
}

function neighbourhood(list, k) {
  if (list.length <= k) return shuffle(list).slice(0, k);
  const anchor = pickAnchor(list);
  return [anchor, ...pickNear(list, anchor.elo, k - 1, [anchor])];
}

/* ---------- the deal ---------- */
function dealStrip(films) {
  const b = classify(films);
  if (b.active.length < 4) return null;
  const r = Math.random();
  let picks = [];
  const field = [...b.contenders, ...b.top];
  // Until enough films are rated, draw from everything. A short field means the
  // same few titles get drafted into every round.
  const bench = field.length >= 40 ? field : b.active;

  // When a big pool has just landed, almost everything is intake, so lean
  // harder on intake rounds. Capped so the top table never starves.
  const share = b.intake.length / Math.max(1, b.active.length);
  const intakeProb = Math.min(0.55, 0.3 + share * 0.35);

  if (b.intake.length >= 2 && r < intakeProb) {
    // newcomers measured against a calibrated yardstick.
    // Shuffle before the sort so films tied at n=0 aren't picked in file order.
    const newcomers = shuffle(b.intake).sort((a, x) => a.n - x.n).slice(0, 2);
    const avg = newcomers.reduce((s, f) => s + f.elo, 0) / newcomers.length;
    picks = [...newcomers, ...pickNear(bench, avg, 2, newcomers)];
  } else if (b.top.length >= 8 && r < intakeProb + 0.22) {
    picks = neighbourhood(b.top, 4); // precision where it matters
  } else if (b.archive.length >= 1 && r > 0.96) {
    const climber = shuffle(b.archive)[0]; // relegation isn't permanent
    picks = [climber, ...pickNear(bench, climber.elo, 3, [climber])];
  } else {
    picks = neighbourhood(bench, 4);
  }

  const seen = new Set(picks.map((f) => f.id));
  const filler = shuffle(b.active.filter((f) => !seen.has(f.id)));
  while (picks.length < 4 && filler.length) picks.push(filler.pop());
  return picks.length === 4 ? shuffle(picks) : null;
}

/* ---------- Elo over a ranked four ---------- */
function applyRanking(films, orderedIds) {
  const map = new Map(films.map((f) => [f.id, f]));
  const pre = orderedIds.map((id) => ({ id, elo: map.get(id).elo }));
  const d = {};
  orderedIds.forEach((id) => (d[id] = 0));
  for (let i = 0; i < pre.length; i++) {
    for (let j = i + 1; j < pre.length; j++) {
      const A = pre[i], B = pre[j];
      const eA = 1 / (1 + Math.pow(10, (B.elo - A.elo) / 400));
      d[A.id] += kFor(map.get(A.id).n) * (1 - eA);
      d[B.id] += kFor(map.get(B.id).n) * (0 - (1 - eA));
    }
  }
  const set = new Set(orderedIds);
  return films.map((f) =>
    set.has(f.id)
      ? { ...f, elo: Math.round((f.elo + d[f.id]) * 10) / 10, n: f.n + 3 }
      : f
  );
}

/* ---------- CSV ---------- */
function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

function importCSV(text, existing) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { added: [], skipped: 0, note: "No rows found in that text." };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const iName = head.findIndex((h) => h === "name" || h === "title" || h === "film");
  const iYear = head.findIndex((h) => h === "year");
  const iRate = head.findIndex((h) => h === "rating" || h === "your rating");
  const iGen = head.findIndex((h) => h === "genres" || h === "genre");
  const iPost = head.findIndex((h) => h === "poster" || h === "poster_path");
  if (iName === -1)
    return { added: [], skipped: 0, note: "Couldn't find a Name or Title column in the header row." };

  const have = new Set(existing.map((f) => f.id));
  const added = []; let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const title = (r[iName] || "").trim();
    if (!title) continue;
    const year = iYear > -1 ? parseInt(r[iYear], 10) || null : null;
    const id = slug(title, year);
    if (have.has(id)) { skipped++; continue; }
    const raw = iRate > -1 ? parseFloat(r[iRate]) : NaN;
    const genres = iGen > -1 && r[iGen]
      ? r[iGen].split(/[|,;]/).map((g) => g.trim()).filter(Boolean)
      : [];
    const rated = !isNaN(raw);
    // no Rating column at all = a watchlist export, so nothing here is seen yet
    const seen = iRate > -1;
    const poster = iPost > -1 ? (r[iPost] || "").trim() : "";
    added.push(makeFilm(title, year, genres, rated ? eloFromStars(raw) : BASE_ELO, seen, poster));
    have.add(id);
  }
  const kind = iRate > -1 ? "rated films" : "watchlist entries";
  return { added, skipped, note: `${added.length} ${kind} added, ${skipped} already in the pool.` };
}

/* ============================ UI ============================ */

const C = {
  ink: "#182629", surface: "#22383D", raise: "#2C474D", hole: "#0D1618",
  bone: "#EDE4D3", amber: "#E0A33E", rust: "#C2553D", mint: "#7FA6A0",
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap');
.fs *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.fs{font-family:Barlow,system-ui,sans-serif;color:${C.bone};background:${C.ink};min-height:100vh}
.fs-d{font-family:'Barlow Condensed',Impact,sans-serif;text-transform:uppercase;letter-spacing:.06em;line-height:1}
.fs-m{font-family:'Space Mono',ui-monospace,monospace}
.fs button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
.fs button:focus-visible,.fs input:focus-visible,.fs textarea:focus-visible{outline:2px solid ${C.amber};outline-offset:2px}
.fs input,.fs textarea{font-family:Barlow,sans-serif;background:${C.ink};color:${C.bone};
  border:1px solid ${C.raise};border-radius:2px;padding:9px 10px;font-size:14px;width:100%}
.fs input::placeholder,.fs textarea::placeholder{color:${C.mint};opacity:.55}
.strip{background:${C.surface};padding:12px 20px;
  background-image:repeating-linear-gradient(to bottom,transparent 0 9px,${C.hole} 9px 21px,transparent 21px 33px),
                   repeating-linear-gradient(to bottom,transparent 0 9px,${C.hole} 9px 21px,transparent 21px 33px);
  background-size:9px 100%,9px 100%;background-position:5px 6px,calc(100% - 5px) 6px;background-repeat:repeat-y}
.frame{display:flex;gap:12px;align-items:stretch;background:${C.raise};border-radius:2px;
  padding:12px 12px 10px;margin-bottom:8px;width:100%;text-align:left;
  transition:transform .12s ease,box-shadow .12s ease;position:relative}
.frame:last-child{margin-bottom:0}
.frame.on{box-shadow:inset 3px 0 0 ${C.amber}}
.frame:active{transform:scale(.985)}
.punch{width:30px;flex:0 0 30px;display:flex;align-items:center;justify-content:center;
  border-right:1px dashed rgba(127,166,160,.28);margin-right:2px}
.chip{border:1px solid ${C.raise};background:transparent;color:${C.mint};border-radius:999px;
  padding:5px 11px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;
  font-family:'Barlow Condensed',sans-serif;font-weight:600}
.chip.on{background:${C.amber};border-color:${C.amber};color:${C.ink}}
.tab{flex:1;padding:11px 4px;font-size:12px;font-weight:600;letter-spacing:.1em;
  font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;color:${C.mint};
  border-bottom:2px solid transparent}
.tab.on{color:${C.bone};border-bottom-color:${C.amber}}
.cta{width:100%;padding:15px;border-radius:2px;font-family:'Barlow Condensed',sans-serif;
  font-weight:700;font-size:17px;letter-spacing:.12em;text-transform:uppercase}
.row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(127,166,160,.14)}
.fs img{display:block}
.scroll::-webkit-scrollbar{height:0;width:0}
@media (prefers-reduced-motion:reduce){.fs *{transition:none!important}}
`;

function Poster({ film, w }) {
  const [failed, setFailed] = useState(false);
  const h = Math.round(w * 1.5);
  const box = { width: w, height: h, flex: `0 0 ${w}px`, borderRadius: 2, background: C.hole };
  if (!film.poster || failed) {
    // no poster on file, or the image didn't load — fall back to a letter tile
    return (
      <div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="fs-d" style={{ fontSize: Math.round(w * 0.44), color: C.mint, opacity: 0.6 }}>
          {film.title.replace(/^(the|a|an|le|la|les|el|den|det)\s+/i, "").charAt(0)}
        </span>
      </div>
    );
  }
  return (
    <img
      src={posterURL(film.poster)} alt="" loading="lazy" decoding="async"
      onError={() => setFailed(true)}
      style={{ ...box, objectFit: "cover" }}
    />
  );
}

const Label = ({ children, style }) => (
  <div className="fs-d" style={{ fontSize: 11, color: C.mint, letterSpacing: ".16em", ...style }}>
    {children}
  </div>
);

export default function Filmstrip() {
  const [films, setFilms] = useState(null);
  const [round, setRound] = useState(0);
  const [tab, setTab] = useState("rank");
  const [strip, setStrip] = useState([]);
  const [order, setOrder] = useState([]);      // ranked ids, best first
  const [undo, setUndo] = useState(null);
  const [genre, setGenre] = useState("All");
  const [showProv, setShowProv] = useState(false);
  const [limit, setLimit] = useState(200);
  const [note, setNote] = useState("");
  const [csv, setCsv] = useState("");
  const [nf, setNf] = useState({ title: "", year: "", genres: "" });
  const saveT = useRef(null);

  /* load */
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY);
        const s = JSON.parse(res.value);
        setFilms(s.films); setRound(s.round || 0);
      } catch {
        setFilms(seedPool()); setRound(0);
      }
    })();
  }, []);

  /* save (debounced) */
  useEffect(() => {
    if (!films) return;
    clearTimeout(saveT.current);
    saveT.current = setTimeout(async () => {
      try { await window.storage.set(STORAGE_KEY, JSON.stringify({ films, round })); }
      catch { setNote("Storage is unavailable — this session won't be saved."); }
    }, 500);
  }, [films, round]);

  /* deal */
  useEffect(() => {
    if (films && strip.length === 0) {
      const s = dealStrip(films);
      if (s) { setStrip(s); setOrder([]); }
    }
  }, [films, strip.length]);

  const deal = (f = films) => {
    const s = dealStrip(f);
    setStrip(s || []); setOrder([]);
  };

  const tap = (id) => {
    setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  };

  const save = () => {
    if (order.length !== 4) return;
    setUndo({ films, round });
    const next = applyRanking(films, order);
    setFilms(next); setRound((r) => r + 1); deal(next);
  };

  const notSeen = (id) => {
    setFilms((fs) => {
      const next = fs.map((f) => (f.id === id ? { ...f, seen: false } : f));
      const rest = strip.filter((f) => f.id !== id);
      const used = new Set(rest.map((f) => f.id));
      const pool = next.filter((f) => f.seen !== false && !used.has(f.id));
      const anchor = rest.reduce((s, f) => s + f.elo, 0) / (rest.length || 1);
      const rep = pickNear(pool, anchor, 1)[0];
      setStrip(rep ? [...rest, rep] : rest);
      setOrder((o) => o.filter((x) => x !== id));
      return next;
    });
  };

  const markSeen = (id) =>
    setFilms((fs) => fs.map((f) => (f.id === id ? { ...f, seen: true } : f)));
  const drop = (id) => setFilms((fs) => fs.filter((f) => f.id !== id));

  const addFilm = () => {
    const t = nf.title.trim();
    if (!t) { setNote("Give the film a title first."); return; }
    const y = parseInt(nf.year, 10) || null;
    const id = slug(t, y);
    if (films.some((f) => f.id === id)) { setNote(`${t} is already in the pool.`); return; }
    const g = nf.genres.split(/[,|;]/).map((x) => x.trim()).filter(Boolean);
    setFilms((fs) => [...fs, makeFilm(t, y, g)]);
    setNf({ title: "", year: "", genres: "" });
    setNote(`${t} added to intake.`);
  };

  const runImport = (text) => {
    const source = typeof text === "string" ? text : csv;
    if (!source.trim()) { setNote("Nothing to import — pick a file or paste some CSV."); return; }
    const r = importCSV(source, films);
    if (r.added.length) setFilms((fs) => [...fs, ...r.added]);
    setNote(r.note); setCsv("");
  };

  const pickFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setNote(`Reading ${file.name}…`);
    const reader = new FileReader();
    reader.onload = () => runImport(String(reader.result));
    reader.onerror = () => setNote("Couldn't read that file.");
    reader.readAsText(file);
    e.target.value = "";   // let the same file be picked again
  };

  const tiers = useMemo(() => (films ? classify(films) : null), [films]);

  const genres = useMemo(() => {
    if (!films) return [];
    const m = new Map();
    films.forEach((f) => f.genres.forEach((g) => m.set(g, (m.get(g) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [films]);

  const chart = useMemo(() => {
    if (!films) return [];
    return films
      .filter((f) => f.seen !== false)
      .filter((f) => genre === "All" || f.genres.includes(genre))
      .filter((f) => showProv || f.n >= CONFIRMED_N)
      .sort((a, b) => b.elo - a.elo);
  }, [films, genre, showProv]);

  const watchlist = useMemo(
    () => (films || []).filter((f) => f.seen === false).sort((a, b) => b.elo - a.elo),
    [films]
  );

  if (!films)
    return (
      <div className="fs" style={{ padding: 40 }}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <Label>Threading the projector…</Label>
      </div>
    );

  return (
    <div className="fs" style={{ maxWidth: 520, margin: "0 auto", paddingBottom: 40 }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* header */}
      <div style={{ padding: "18px 16px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="fs-d" style={{ fontSize: 27, fontWeight: 700 }}>Filmstrip</div>
          <Label style={{ marginTop: 5 }}>Rank four · repeat forever</Label>
        </div>
        <div className="fs-m" style={{ fontSize: 10, color: C.mint, textAlign: "right", lineHeight: 1.6 }}>
          <div>RD {String(round).padStart(4, "0")}</div>
          <div>{films.length} FILMS</div>
        </div>
      </div>

      <div style={{ display: "flex", borderBottom: `1px solid ${C.surface}`, padding: "0 8px" }}>
        {[["rank", "Rank"], ["charts", "Charts"], ["watch", `List ${watchlist.length ? watchlist.length : ""}`], ["pool", "Pool"]]
          .map(([k, l]) => (
            <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => { setTab(k); setNote(""); }}>{l}</button>
          ))}
      </div>

      {note && (
        <div className="fs-m" style={{ fontSize: 11, color: C.amber, padding: "10px 16px 0" }}>{note}</div>
      )}

      {/* ---------------- RANK ---------------- */}
      {tab === "rank" && (
        <div style={{ padding: 16 }}>
          <Label style={{ marginBottom: 10 }}>
            Tap in order — best first{order.length ? ` · ${order.length}/4` : ""}
          </Label>

          {strip.length === 4 ? (
            <div className="strip">
              {strip.map((f) => {
                const pos = order.indexOf(f.id);
                return (
                  <div key={f.id} className={`frame ${pos > -1 ? "on" : ""}`}>
                    <button
                      onClick={() => tap(f.id)}
                      style={{ display: "flex", flex: 1, gap: 10, alignItems: "center", padding: 0 }}
                      aria-label={`Rank ${f.title}`}
                    >
                      <div className="punch">
                        {pos > -1 ? (
                          <span className="fs-m" style={{ fontSize: 21, fontWeight: 700, color: C.amber }}>{pos + 1}</span>
                        ) : (
                          <span style={{ width: 13, height: 13, borderRadius: "50%", border: `1.5px solid ${C.mint}`, opacity: .5, display: "block" }} />
                        )}
                      </div>
                      <Poster film={f} w={46} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="fs-d" style={{ fontSize: 17, fontWeight: 600 }}>{f.title}</div>
                        <div className="fs-m" style={{ fontSize: 10, color: C.mint, marginTop: 4 }}>
                          {[f.year, f.genres.join(" · ")].filter(Boolean).join("  ·  ") || "no year"}
                          {f.n < INTAKE_N ? "  ·  NEW" : ""}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => notSeen(f.id)}
                      className="fs-d"
                      style={{ fontSize: 10, color: C.rust, alignSelf: "center", padding: "8px 2px 8px 8px", letterSpacing: ".1em" }}
                    >
                      Not<br />seen
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: "30px 0", color: C.mint, fontSize: 14 }}>
              Fewer than four films left to compare. Add some in the Pool tab.
            </div>
          )}

          <button
            className="cta"
            onClick={save}
            disabled={order.length !== 4}
            style={{
              marginTop: 14,
              background: order.length === 4 ? C.amber : "transparent",
              color: order.length === 4 ? C.ink : C.mint,
              border: order.length === 4 ? "none" : `1px solid ${C.raise}`,
              cursor: order.length === 4 ? "pointer" : "default",
            }}
          >
            {order.length === 4 ? "Save ranking" : `Rank all four (${order.length}/4)`}
          </button>

          <div style={{ display: "flex", gap: 18, marginTop: 14, justifyContent: "center" }}>
            <button className="fs-d" style={{ fontSize: 11, color: C.mint }} onClick={() => deal()}>Deal a new strip</button>
            {order.length > 0 && (
              <button className="fs-d" style={{ fontSize: 11, color: C.mint }} onClick={() => setOrder([])}>Clear ranks</button>
            )}
            {undo && (
              <button
                className="fs-d" style={{ fontSize: 11, color: C.rust }}
                onClick={() => { setFilms(undo.films); setRound(undo.round); setUndo(null); deal(undo.films); setNote("Last ranking undone."); }}
              >Undo last</button>
            )}
          </div>

          {tiers && (
            <div className="fs-m" style={{ fontSize: 10, color: C.mint, marginTop: 22, lineHeight: 1.8, opacity: .8 }}>
              <div>INTAKE {tiers.intake.length} · CONTENDERS {tiers.contenders.length} · TOP TABLE {tiers.top.length} · ARCHIVE {tiers.archive.length}</div>
              <div>{round * 6} pairwise comparisons logged</div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- CHARTS ---------------- */}
      {tab === "charts" && (
        <div style={{ padding: 16 }}>
          <div className="scroll" style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 12 }}>
            {["All", ...genres.map((g) => g[0])].map((g) => (
              <button key={g} className={`chip ${genre === g ? "on" : ""}`}
                onClick={() => { setGenre(g); setLimit(200); }}>{g}</button>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Label>{genre === "All" ? "Overall" : `Best ${genre}`} · {chart.length}</Label>
            <button className="fs-d" style={{ fontSize: 10, color: showProv ? C.amber : C.mint }} onClick={() => setShowProv((v) => !v)}>
              {showProv ? "Hiding nothing" : "Confirmed only"}
            </button>
          </div>

          {chart.length === 0 ? (
            <div style={{ color: C.mint, fontSize: 14, padding: "24px 0" }}>
              Nothing has reached {CONFIRMED_N} comparisons here yet. Rank a few strips, or turn off “Confirmed only” to peek early.
            </div>
          ) : (
            chart.slice(0, limit).map((f, i) => (
              <div key={f.id}>
                <div className="row">
                  <span className="fs-m" style={{ fontSize: 11, color: i < 4 ? C.amber : C.mint, width: 26, flex: "0 0 26px" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Poster film={f} w={28} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="fs-d" style={{ fontSize: 16, fontWeight: 600 }}>{f.title}</span>
                    <span className="fs-m" style={{ fontSize: 10, color: C.mint, display: "block", marginTop: 3 }}>
                      {f.year} · {f.n} comps{f.n < CONFIRMED_N ? " · provisional" : ""}
                    </span>
                  </span>
                  <span className="fs-m" style={{ fontSize: 13, color: C.bone }}>{Math.round(f.elo)}</span>
                </div>
                {i === 3 && genre === "All" && (
                  <Label style={{ padding: "9px 0 3px", color: C.amber }}>↑ your four favourites</Label>
                )}
              </div>
            ))
          )}

          {chart.length > limit && (
            <button className="cta" onClick={() => setLimit((l) => l + 200)}
              style={{ marginTop: 16, background: "transparent", border: `1px solid ${C.raise}`, color: C.bone, fontSize: 14 }}>
              Show 200 more · {chart.length - limit} below
            </button>
          )}
        </div>
      )}

      {/* ---------------- WATCHLIST ---------------- */}
      {tab === "watch" && (
        <div style={{ padding: 16 }}>
          <Label style={{ marginBottom: 4 }}>To watch · {watchlist.length}</Label>
          <div style={{ fontSize: 13, color: C.mint, marginBottom: 14 }}>
            Everything you tapped “Not seen” on, plus anything imported from a watchlist export.
          </div>
          {watchlist.length === 0 ? (
            <div style={{ color: C.mint, fontSize: 14 }}>Empty. Tap “Not seen” on a frame and it lands here.</div>
          ) : (
            watchlist.map((f) => (
              <div key={f.id} className="row">
                <Poster film={f} w={28} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="fs-d" style={{ fontSize: 16, fontWeight: 600 }}>{f.title}</span>
                  <span className="fs-m" style={{ fontSize: 10, color: C.mint, display: "block", marginTop: 3 }}>
                    {[f.year, f.genres.join(" · ")].filter(Boolean).join("  ·  ")}
                  </span>
                </span>
                <button className="fs-d" style={{ fontSize: 10, color: C.amber }} onClick={() => markSeen(f.id)}>Seen it</button>
                <button className="fs-d" style={{ fontSize: 10, color: C.rust }} onClick={() => drop(f.id)}>Remove</button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ---------------- POOL ---------------- */}
      {tab === "pool" && (
        <div style={{ padding: 16 }}>
          <Label style={{ marginBottom: 10 }}>Add a film</Label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input placeholder="Title" value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} />
            <input placeholder="Year" inputMode="numeric" style={{ width: 78, flex: "0 0 78px" }}
              value={nf.year} onChange={(e) => setNf({ ...nf, year: e.target.value })} />
          </div>
          <input placeholder="Genres, comma separated (optional)" value={nf.genres}
            onChange={(e) => setNf({ ...nf, genres: e.target.value })} />
          <button className="cta" onClick={addFilm}
            style={{ marginTop: 10, background: "transparent", border: `1px solid ${C.amber}`, color: C.amber, fontSize: 14 }}>
            Add to intake
          </button>

          <Label style={{ margin: "28px 0 8px" }}>Import a CSV</Label>
          <div style={{ fontSize: 13, color: C.mint, marginBottom: 10, lineHeight: 1.5 }}>
            Pick <span className="fs-m">filmstrip_pool.csv</span> from the TMDB script, then{" "}
            <span className="fs-m">filmstrip_watchlist.csv</span> if you have one. A raw Letterboxd{" "}
            <span className="fs-m">ratings.csv</span> works too, it just won’t carry genres or posters.
          </div>

          <label
            className="cta"
            style={{ display: "block", textAlign: "center", background: C.amber, color: C.ink, cursor: "pointer" }}
          >
            Choose a CSV file
            <input type="file" accept=".csv,text/csv" onChange={pickFile}
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
          </label>

          <details style={{ marginTop: 14 }}>
            <summary className="fs-d" style={{ fontSize: 11, color: C.mint, cursor: "pointer" }}>
              Or paste it instead
            </summary>
            <textarea rows={5} placeholder="Paste CSV here" value={csv}
              onChange={(e) => setCsv(e.target.value)} style={{ marginTop: 10 }} />
            <button className="cta" onClick={() => runImport()}
              style={{ marginTop: 10, background: "transparent", border: `1px solid ${C.raise}`, color: C.bone, fontSize: 14 }}>
              Import pasted text
            </button>
          </details>

          <Label style={{ margin: "28px 0 8px" }}>Where things stand</Label>
          <div className="fs-m" style={{ fontSize: 11, color: C.mint, lineHeight: 2 }}>
            <div>POOL {films.length} · SEEN {films.filter((f) => f.seen !== false).length} · TO WATCH {watchlist.length}</div>
            <div>ROUNDS {round} · COMPARISONS {round * 6}</div>
            <div>WITH GENRES {films.filter((f) => f.genres.length).length} · GENRES {genres.length}</div>
          </div>

          <button
            className="fs-d"
            style={{ marginTop: 26, fontSize: 11, color: C.rust }}
            onClick={() => {
              if (note === "Tap again to wipe everything.") {
                setFilms(seedPool()); setRound(0); setUndo(null); setStrip([]); setNote("Back to the seed pool.");
              } else setNote("Tap again to wipe everything.");
            }}
          >
            Reset to seed pool
          </button>
        </div>
      )}
    </div>
  );
}
