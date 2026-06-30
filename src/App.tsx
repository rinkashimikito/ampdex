import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import data from './data/amps.json';
import wikiStatus from './data/wiki-status.json';
import usageData from './data/amp-usage.json';
import guitaristsData from './data/guitarists.json';
import ampTagsData from './data/amp-tags.json';
import './App.css';

type Amp = {
  num: string;
  name: string;
  printedPage: number;
  pdfPage: number;
  body: string[];
  images: string[];
  /** lazily computed: body joined to a single searchable string */
  bodyText: string;
  /** lazily computed: search aliases for brand/model nicknames */
  aliases: string;
};

type WikiEntry = { anchor: string; description: string };

type UsageLink = {
  url: string;
  title: string;
  supporting_quote?: string;
  strength?: 'strong' | 'moderate' | 'weak';
};
type UsageEntry = {
  brand?: string;
  realAmp?: string;
  realAmpLink?: string | null;
  artists?: string[];
  songs?: string[];
  songLink?: string | null;
  info?: string[];
  infoLink?: string | null;
  usage?: { artist: string; links: UsageLink[] }[];
};
const usageByName = usageData as Record<string, UsageEntry>;
const STRENGTH_GLYPH = { strong: '●', moderate: '◐', weak: '○' } as const;

const WIKI_BASE = 'https://wiki.fractalaudio.com/wiki/index.php?title=Amp_models_list';

function normalizeWikiKey(s: string): string {
  let out = s
    .toUpperCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-');
  out = out.replace(/^'+/, '');
  out = out.replace(/\s*([/-])\s*/g, '$1');
  return out.replace(/\s+/g, ' ').trim();
}

function wikiEntryFor(name: string): WikiEntry | null {
  const entries = (wikiStatus as { entries?: Record<string, WikiEntry> }).entries;
  if (!entries) return null;
  return entries[normalizeWikiKey(name)] ?? null;
}

function wikiUrlFor(name: string): string {
  const e = wikiEntryFor(name);
  return e?.anchor ? `${WIKI_BASE}#${encodeURIComponent(e.anchor).replace(/'/g, '%27')}` : WIKI_BASE;
}

type AliasRule = { match: RegExp; aliases: string[] };

const ALIAS_RULES: AliasRule[] = [
  { match: /^CLASS-A 30W/, aliases: ['ac30', 'ac 30', 'ac-30', 'vox ac30', 'top boost', 'topboost'] },
  { match: /^CLASS-A 15W/, aliases: ['ac15', 'ac 15', 'ac-15', 'vox ac15'] },
  { match: /^CLASS-A/, aliases: ['vox'] },
  { match: /^BRIT PLEXI/, aliases: ['plexi', '1959', '1987', 'super lead', 'marshall plexi'] },
  { match: /^BRIT 800 2203/, aliases: ['jcm800 2203', 'jcm 800 2203', '2203'] },
  { match: /^BRIT 800 2204/, aliases: ['jcm800 2204', 'jcm 800 2204', '2204'] },
  { match: /^BRIT 800/, aliases: ['jcm800', 'jcm 800'] },
  { match: /^BRIT JM45/, aliases: ['jtm45', 'jtm 45'] },
  { match: /^BRIT JVM/, aliases: ['jvm'] },
  { match: /^BRIT JCM900/, aliases: ['jcm900', 'jcm 900'] },
  { match: /^BRIT /, aliases: ['marshall'] },
  { match: /^USA RECTO|^USA RECT|^RECTO|^DUAL RECT/, aliases: ['rectifier', 'mesa rectifier', 'recto', 'dual recto'] },
  { match: /^USA LEAD|^USA MK|^USA MARK/, aliases: ['mesa mark', 'mesa lead', 'boogie'] },
  { match: /^USA /, aliases: ['mesa', 'mesa boogie', 'boogie'] },
  { match: /^TWEED|^'5\d|^'6\d|^DELUXE|^BASSGUY|^TWIN|^PRINCE|^CHAMP|^VIBRO|^BANDMASTER|^BROWN(F|FACE)/, aliases: ['fender'] },
  { match: /^DELUXE/, aliases: ['fender deluxe'] },
  { match: /^TWIN/, aliases: ['fender twin'] },
  { match: /^PRINCE/, aliases: ['fender princeton', 'princeton'] },
  { match: /^CHAMP|CHAMPLIFIER/, aliases: ['fender champ'] },
  { match: /^BASSGUY/, aliases: ['fender bassman', 'bassman'] },
  { match: /^5153|^5150/, aliases: ['evh', 'van halen', 'eddie van halen'] },
  { match: /^FRIEDMAN|^BE-?100|^BE100|^HBE|^DIRTY SHIRLEY/, aliases: ['friedman', 'brown eye'] },
  { match: /^DIEZEL|^HERBIE|^VH4|^HAGEN/, aliases: ['diezel'] },
  { match: /^BOGNER|^XTC|^UBERSCHALL/, aliases: ['bogner'] },
  { match: /^SOLDANO|^SLO|^X88|^X99/, aliases: ['soldano'] },
  { match: /^ENGL|^FIREBALL|^POWERBALL|^E650|^E670/, aliases: ['engl'] },
  { match: /^MATCHBOX/, aliases: ['matchless'] },
  { match: /^DR Z|^MAZ|^Z[- ]28|^STINGRAY/, aliases: ['dr z', 'dr. z'] },
  { match: /^TWO[- ]ROCK|^TWOROCK/, aliases: ['two rock', 'two-rock'] },
  { match: /^DUMBLE|^ODS|^OVERDRIVE SPECIAL/, aliases: ['dumble'] },
  { match: /^HIWATT|^HIPWR/, aliases: ['hiwatt'] },
  { match: /^ORANGE|^OR[- ]?\d|^TINY TERROR|^ROCKER/, aliases: ['orange'] },
  { match: /^PVH|^PEAVEY|^TRIPLE X|^XXX|^6505|^6534/, aliases: ['peavey'] },
];

function aliasesFor(name: string): string {
  const set = new Set<string>();
  for (const r of ALIAS_RULES) {
    if (r.match.test(name)) {
      for (const a of r.aliases) set.add(a);
    }
  }
  return Array.from(set).join(' ');
}

type GeneralPage = {
  pdfPage: number;
  printedPage: number;
  title: string;
  text: string;
};

type GuitaristAmp = {
  brand: string;
  model: string;
  links: UsageLink[];
  libraryAmps: string[];
};
type Guitarist = {
  slug: string;
  name: string;
  bands: string[];
  amps: GuitaristAmp[];
};
const guitarists = guitaristsData as Guitarist[];
const guitaristBySlug: Record<string, Guitarist> = Object.fromEntries(
  guitarists.map((g) => [g.slug, g]),
);

type AmpTag = {
  realAmp?: string | null;
  cab?: string | null;
  cabOrig?: string | null;
  powerTubes?: string | null;
  preampTubes?: string | null;
  controls?: string | null;
  tonestack?: string | null;
  variants?: string[];
  gain?: string | null;
  genres?: string[];
  gainBasis?: string | null;
  gainConfidence?: string | null;
};
const tagsByName = ampTagsData as Record<string, AmpTag>;
const GAIN_LABEL: Record<string, string> = {
  clean: 'Clean',
  breakup: 'Edge of breakup',
  crunch: 'Crunch',
  'mid-gain': 'Mid gain',
  'high-gain': 'High gain',
};

type Collection = { key: string; label: string; test: (t: AmpTag) => boolean };
const COLLECTIONS: Collection[] = [
  { key: 'clean', label: 'Cleans', test: (t) => t.gain === 'clean' },
  { key: 'breakup', label: 'Edge of breakup', test: (t) => t.gain === 'breakup' },
  { key: 'crunch', label: 'Crunch', test: (t) => t.gain === 'crunch' },
  { key: 'high-gain', label: 'High gain', test: (t) => t.gain === 'high-gain' },
  {
    key: 'metal',
    label: 'Metal & djent',
    test: (t) => !!t.genres?.some((g) => g === 'metal' || g === 'djent'),
  },
  { key: 'blues', label: 'Blues', test: (t) => !!t.genres?.includes('blues') },
  { key: 'boutique', label: 'Boutique', test: (t) => !!t.genres?.includes('boutique') },
  { key: 'bass', label: 'Bass', test: (t) => !!t.genres?.includes('bass') },
];
const collectionByKey: Record<string, Collection> = Object.fromEntries(
  COLLECTIONS.map((c) => [c.key, c]),
);

type ResultItem =
  | { kind: 'amp'; item: Amp; score: number; highlights: ReadonlyArray<{ key: string; matches: ReadonlyArray<readonly [number, number]> }> }
  | { kind: 'general'; item: GeneralPage; score: number }
  | { kind: 'guitarist'; item: Guitarist; score: number };

const IMG_URL = (file: string) => `${import.meta.env.BASE_URL}amp-images/${file}`;

function highlight(text: string, ranges: ReadonlyArray<readonly [number, number]>) {
  if (!ranges || ranges.length === 0) return text;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<string | { mark: string }> = [];
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push({ mark: text.slice(start, end + 1) });
    cursor = end + 1;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return (
    <>
      {out.map((p, i) =>
        typeof p === 'string' ? (
          <span key={i}>{p}</span>
        ) : (
          <mark key={i}>{p.mark}</mark>
        ),
      )}
    </>
  );
}

type Device = 'III' | 'FM9' | 'FM3' | 'II_AX8';

const DEVICE_LABELS: Record<Device, string> = {
  III: 'Axe-Fx III',
  FM9: 'FM9',
  FM3: 'FM3',
  II_AX8: 'Axe-Fx II / AX8',
};

const FM3_CAVEAT_PATTERNS = [/bias[\s-]?tremolo/i, /input[\s-]?dynamics?/i];
const ampHasFm3Caveat = (body: string[]) =>
  body.some((b) => FM3_CAVEAT_PATTERNS.some((p) => p.test(b)));

const FAMOUS_PLAYERS = [
  'Hendrix', 'Clapton', 'Page', 'Gilmour', 'Slash', 'Van Halen', 'EVH', 'Eddie Van Halen',
  'Vai', 'Satriani', 'Petrucci', 'Mayer', 'Knopfler', 'SRV', 'Stevie Ray', 'B.B. King',
  'BB King', 'Rory Gallagher', 'Iommi', 'Beck', 'Townshend', 'Brian May', 'Angus',
  'Malmsteen', 'Friedman', 'Gilbert', 'Lukather', 'Frusciante', 'Bonamassa', 'Hammett',
  'Mustaine', 'Rhoads', 'Dimebag', 'Wylde', 'Cobain', 'Edge', 'Jack White', 'Holdsworth',
  'Lifeson', 'Schenker', 'Blackmore', 'Trower', 'Allman', 'Buchanan', 'Robertson',
  'Reinhardt', 'Walsh', 'Cantrell', 'Perry', 'Tyler', 'Morello', 'Buckethead',
  'Santana', 'Carlos Santana', 'Mark Knopfler', 'David Gilmour', 'Jeff Beck',
  'Jimmy Page', 'Jimi Hendrix', 'Eric Clapton', 'Steve Vai', 'Joe Bonamassa',
  'Joe Satriani', 'John Mayer', 'John Petrucci', 'John Frusciante', 'Yngwie',
  'Zakk Wylde', 'Tom Morello', 'James Hetfield', 'Hetfield', 'Kirk Hammett',
  'Adam Jones', 'John Sykes', 'George Lynch', 'Vivian Campbell', 'Phil Collen',
  'Joe Walsh', 'Don Felder', 'Lindsey Buckingham', 'Prince', 'Nuno Bettencourt',
  'Paul Gilbert', 'Marty Friedman', 'Misha Mansoor', 'Tosin Abasi', 'Plini',
  'Polyphia', 'Tim Henson', 'Periphery', 'Animals as Leaders',
];

const playerRegex = new RegExp(
  `\\b(${FAMOUS_PLAYERS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i',
);
const quotedSongRegex = /["“'']([^"”'']{2,60})["”'']/;

function isFamousBullet(text: string): boolean {
  return playerRegex.test(text) || quotedSongRegex.test(text);
}

function highlightAcrossBullets(bullets: string[], regexes: RegExp[]): React.ReactNode[] {
  return bullets.map((b, i) => {
    const ranges: Array<readonly [number, number]> = [];
    for (const re of regexes) {
      const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m: RegExpExecArray | null;
      while ((m = r.exec(b)) !== null) {
        ranges.push([m.index, m.index + m[0].length - 1]);
        if (ranges.length > 8) break;
      }
    }
    return <li key={i}>{ranges.length ? highlight(b, ranges) : b}</li>;
  });
}

export default function App() {
  const amps = useMemo<Amp[]>(
    () =>
      (data.amps as Omit<Amp, 'bodyText' | 'aliases'>[]).map((a) => ({
        ...a,
        bodyText: a.body.join('\n'),
        aliases: aliasesFor(a.name),
      })),
    [],
  );
  const general = data.general as GeneralPage[];

  const nameFuse = useMemo(
    () =>
      new Fuse<Amp>(amps, {
        keys: [
          { name: 'name', weight: 5 },
          { name: 'aliases', weight: 4 },
          { name: 'num', weight: 2 },
          { name: 'bodyText', weight: 1 },
        ],
        includeScore: true,
        includeMatches: true,
        threshold: 0.2,
        distance: 200,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    [amps],
  );

  const generalFuse = useMemo(
    () =>
      new Fuse<GeneralPage>(general, {
        keys: ['title', 'text'],
        includeScore: true,
        includeMatches: true,
        threshold: 0.3,
        ignoreLocation: true,
        minMatchCharLength: 3,
      }),
    [general],
  );

  const [query, setQuery] = useState(() => {
    if (typeof window === 'undefined') return '';
    const q = new URLSearchParams(window.location.hash.slice(1)).get('q');
    return q ? decodeURIComponent(q) : '';
  });
  const [selected, setSelected] = useState<Amp | null>(() => {
    if (typeof window === 'undefined') return null;
    const a = new URLSearchParams(window.location.hash.slice(1)).get('a');
    return a ? amps.find((x) => x.num === a) ?? null : null;
  });
  const [selGuitar, setSelGuitar] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const g = new URLSearchParams(window.location.hash.slice(1)).get('g');
    return g && guitaristBySlug[g] ? g : null;
  });
  const [collection, setCollection] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const c = new URLSearchParams(window.location.hash.slice(1)).get('c');
    return c && collectionByKey[c] ? c : null;
  });
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [device, setDevice] = useState<Device | null>(() => {
    if (typeof window === 'undefined') return null;
    const saved = window.localStorage.getItem('axefx-device');
    return saved && ['III', 'FM9', 'FM3', 'II_AX8'].includes(saved)
      ? (saved as Device)
      : null;
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (device) window.localStorage.setItem('axefx-device', device);
  }, [device]);

  // Change the query and drop any pinned selection so the best match shows
  const changeQuery = (v: string) => {
    setQuery(v);
    setSelected(null);
    setSelGuitar(null);
    setCollection(null);
  };
  const pickCollection = (key: string) => {
    setCollection(key);
    setQuery('');
    setSelected(null);
    setSelGuitar(null);
  };

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        if (zoomImg !== null) setZoomImg(null);
        else if (selGuitar) setSelGuitar(null);
        else if (selected) setSelected(null);
        else if (collection) setCollection(null);
        else if (query) setQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query, selected, selGuitar, collection, zoomImg]);

  const results: ResultItem[] = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const lower = trimmed.toLowerCase();
    const tokens = lower.split(/\s+/).filter((t) => t.length >= 2);

    const exactRegexes = tokens.map(
      (t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
    );

    type Hit = {
      amp: Amp;
      score: number;
      highlights: Array<{
        key: string;
        matches: ReadonlyArray<readonly [number, number]>;
      }>;
    };

    const findMatches = (haystack: string, regex: RegExp) => {
      const matches: Array<readonly [number, number]> = [];
      const r = new RegExp(
        regex.source,
        regex.flags.includes('g') ? regex.flags : regex.flags + 'g',
      );
      let m: RegExpExecArray | null;
      while ((m = r.exec(haystack)) !== null) {
        matches.push([m.index, m.index + m[0].length - 1]);
        if (matches.length > 8) break;
      }
      return matches;
    };

    const W = { name: 100, alias: 80, body: 10, exactName: 200, num: 500 };

    const hits = new Map<string, Hit>();

    for (const a of amps) {
      const nameLower = a.name.toLowerCase();
      let pos = 0;
      const highlights: Hit['highlights'] = [];

      let nameTokenHits = 0;
      const nameRanges: Array<readonly [number, number]> = [];
      for (const re of exactRegexes) {
        const ms = findMatches(a.name, re);
        if (ms.length) {
          nameTokenHits += 1;
          nameRanges.push(...ms);
        }
      }
      if (nameTokenHits > 0) {
        pos += W.name * nameTokenHits;
        if (nameTokenHits === tokens.length) pos += W.name;
        highlights.push({ key: 'name', matches: nameRanges });
      }
      if (nameLower === lower) pos += W.exactName;

      if (a.num === lower.padStart(3, '0') || a.num === lower) {
        pos += W.num;
        highlights.push({ key: 'num', matches: [[0, a.num.length - 1]] });
      }

      let aliasTokenHits = 0;
      for (const re of exactRegexes) {
        const ms = findMatches(a.aliases, re);
        if (ms.length) aliasTokenHits += 1;
      }
      if (aliasTokenHits > 0) {
        pos += W.alias * aliasTokenHits;
        if (aliasTokenHits === tokens.length) pos += W.alias;
      }

      let bodyTokenHits = 0;
      const bodyRanges: Array<readonly [number, number]> = [];
      for (const re of exactRegexes) {
        const ms = findMatches(a.bodyText, re);
        if (ms.length) {
          bodyTokenHits += 1;
          bodyRanges.push(...ms);
        }
      }
      if (bodyTokenHits > 0) {
        pos += W.body * bodyTokenHits;
        if (bodyTokenHits === tokens.length) pos += W.body;
        highlights.push({ key: 'body', matches: bodyRanges });
      }

      if (pos > 0) {
        hits.set(a.num, { amp: a, score: 1 / (1 + pos), highlights });
      }
    }

    if (hits.size < 8) {
      const fuzzy = nameFuse.search(trimmed, { limit: 15 });
      for (const f of fuzzy) {
        if ((f.score ?? 1) > 0.4) continue; // gate out scattered-subsequence noise
        if (hits.has(f.item.num)) continue;
        const ranges: ReadonlyArray<readonly [number, number]> = (f.matches ?? [])
          .filter((m) => m.key === 'name')
          .flatMap((m) => (m.indices ?? []) as ReadonlyArray<readonly [number, number]>);
        hits.set(f.item.num, {
          amp: f.item,
          score: 0.6 + (f.score ?? 0),
          highlights: [{ key: 'name', matches: ranges }],
        });
      }
    }

    const ampResults: ResultItem[] = Array.from(hits.values())
      .sort((a, b) => a.score - b.score)
      .slice(0, 30)
      .map((h) => ({
        kind: 'amp' as const,
        item: h.amp,
        score: h.score,
        highlights: h.highlights,
      }));

    const genHits = generalFuse.search(trimmed, { limit: 3 });
    const genResults: ResultItem[] = genHits
      .filter((h) => (h.score ?? 1) <= 0.4) // drop scattered-subsequence noise (e.g. "santa" → Page 36)
      .filter((h) => !/^page\s*\d+$/i.test(h.item.title.trim())) // hide generic "Page N" entries
      .map((h) => ({
        kind: 'general' as const,
        item: h.item,
        score: (h.score ?? 1) + 0.5,
      }));

    // Guitarist matches: precise token-substring against name + bands (no fuzzy
    // noise). All query tokens must appear; exact name match ranks highest.
    const guitaristResults: ResultItem[] = [];
    for (const g of guitarists) {
      const nameLower = g.name.toLowerCase();
      const hay = `${nameLower} ${g.bands.join(' ').toLowerCase()}`;
      if (!tokens.every((t) => hay.includes(t))) continue;
      let gs = 0.02;
      if (nameLower === lower) gs = 0.001;
      else if (tokens.every((t) => nameLower.includes(t))) gs = 0.004;
      guitaristResults.push({ kind: 'guitarist', item: g, score: gs });
    }

    return [...guitaristResults, ...ampResults, ...genResults].sort(
      (a, b) => a.score - b.score,
    );
  }, [query, amps, nameFuse, generalFuse]);

  const ampByName = useMemo(
    () => Object.fromEntries(amps.map((a) => [a.name, a])),
    [amps],
  );
  const ampByNum = useMemo(
    () => Object.fromEntries(amps.map((a) => [a.num, a])),
    [amps],
  );
  // Cross-nav from a guitarist card into a library amp: clear the search so the
  // list + detail both reflect the amp (consistent navigation).
  const pickAmp = (name: string) => {
    const a = ampByName[name];
    if (a) {
      setQuery('');
      setSelected(a);
      setSelGuitar(null);
      setCollection(null);
    }
  };

  // App state → URL hash. Amp/guitarist selections push a history entry (so the
  // back button works); query edits replace it (no per-keystroke spam). Makes
  // amps, guitarists, and searches all shareable/bookmarkable.
  useEffect(() => {
    const target = selected
      ? `#a=${selected.num}`
      : selGuitar
        ? `#g=${selGuitar}`
        : collection
          ? `#c=${collection}`
          : query.trim()
            ? `#q=${encodeURIComponent(query.trim())}`
            : '';
    if (target === window.location.hash || (!target && !window.location.hash)) {
      return;
    }
    const base = window.location.pathname + window.location.search;
    if (selected || selGuitar || collection) {
      window.location.hash = target; // new history entry
    } else {
      window.history.replaceState(null, '', target ? base + target : base);
    }
  }, [query, selected, selGuitar, collection]);

  // URL hash → app state (deep links, browser back/forward).
  useEffect(() => {
    const onHash = () => {
      const p = new URLSearchParams(window.location.hash.slice(1));
      const a = p.get('a');
      const g = p.get('g');
      const c = p.get('c');
      const q = p.get('q');
      if (a && ampByNum[a]) {
        setSelected(ampByNum[a]);
        setSelGuitar(null);
        setCollection(null);
        setQuery('');
      } else if (g && guitaristBySlug[g]) {
        setSelGuitar(g);
        setSelected(null);
        setCollection(null);
        setQuery('');
      } else if (c && collectionByKey[c]) {
        setCollection(c);
        setSelected(null);
        setSelGuitar(null);
        setQuery('');
      } else if (q != null) {
        setQuery(decodeURIComponent(q));
        setSelected(null);
        setSelGuitar(null);
        setCollection(null);
      } else {
        setQuery('');
        setSelected(null);
        setSelGuitar(null);
        setCollection(null);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [ampByNum]);

  // When there is no active query, the list still reflects a deep-linked /
  // cross-navigated selection so the UI stays consistent with the detail pane.
  const listResults: ResultItem[] = query.trim()
    ? results
    : collection && collectionByKey[collection]
      ? amps
          .filter((a) => {
            const t = tagsByName[a.name];
            return t ? collectionByKey[collection].test(t) : false;
          })
          .map((a) => ({ kind: 'amp' as const, item: a, score: 0, highlights: [] }))
      : selGuitar && guitaristBySlug[selGuitar]
        ? [{ kind: 'guitarist', item: guitaristBySlug[selGuitar], score: 0 }]
        : selected
          ? [{ kind: 'amp', item: selected, score: 0, highlights: [] }]
          : [];
  const topMatch = listResults[0];

  if (!device) {
    return <DeviceGate onPick={setDevice} />;
  }

  if (device === 'II_AX8') {
    return <OutOfScope onBack={() => setDevice(null)} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Amplifier Library</h1>
          <p>
            <span className="device-pill">{DEVICE_LABELS[device]}</span>
            <span className="device-sep">·</span>
            <button className="device-change" onClick={() => setDevice(null)}>
              change device
            </button>
            <span className="device-sep">·</span>
            331 amps · Welch v1
          </p>
        </div>
        <div className="search-wrap">
          <input
            ref={inputRef}
            className="search"
            placeholder="Search — name, player, tone, tubes…   /"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          {query && (
            <button className="clear" aria-label="clear" onClick={() => changeQuery('')}>
              ×
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {!query && !selected && !selGuitar && !collection && (
          <section className="empty">
            <h2>Three hundred thirty-one amps. One field.</h2>
            <p>
              <button onClick={() => setQuery('5150')}>5150</button>
              <button onClick={() => setQuery('plexi')}>plexi</button>
              <button onClick={() => setQuery('Hendrix')}>hendrix</button>
              <button onClick={() => setQuery('mesa rectifier')}>mesa rectifier</button>
              <button onClick={() => setQuery('clean fender')}>clean fender</button>
              <button onClick={() => setQuery('bias')}>bias</button>
            </p>
            <div className="collections">
              <span className="collections-label">Start here</span>
              {COLLECTIONS.map((c) => (
                <button
                  key={c.key}
                  className="collection-chip"
                  onClick={() => pickCollection(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="hint">Fuzzy. <kbd>/</kbd> to focus &nbsp; <kbd>Esc</kbd> to clear</p>
          </section>
        )}

        {query && results.length === 0 && (
          <section className="empty">
            <h2>No matches</h2>
            <p>Nothing found for “{query}”. Try fewer or different words.</p>
          </section>
        )}

        {topMatch && (
          <section className="layout">
            <aside className="results">
              <div className="results-count">
                {collection && collectionByKey[collection]
                  ? `${collectionByKey[collection].label} · `
                  : ''}
                {listResults.length} match{listResults.length === 1 ? '' : 'es'}
              </div>
              <ul>
                {listResults.map((r, i) => {
                  if (r.kind === 'amp') {
                    const a = r.item;
                    const isActive = selGuitar
                      ? false
                      : selected
                        ? selected.num === a.num
                        : i === 0;
                    return (
                      <li
                        key={`amp-${a.num}`}
                        className={isActive ? 'active' : ''}
                        onClick={() => {
                          setSelected(a);
                          setSelGuitar(null);
                        }}
                      >
                        <div className="num">{a.num}</div>
                        <div className="meta">
                          <div className="name">{a.name}</div>
                          {wikiEntryFor(a.name)?.description && (
                            <div className="loc">{wikiEntryFor(a.name)!.description}</div>
                          )}
                        </div>
                      </li>
                    );
                  }
                  if (r.kind === 'guitarist') {
                    const g = r.item;
                    const isActive = selGuitar
                      ? selGuitar === g.slug
                      : !selected && i === 0;
                    return (
                      <li
                        key={`gtr-${g.slug}`}
                        className={`guitarist ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          setSelGuitar(g.slug);
                          setSelected(null);
                        }}
                      >
                        <div className="num">♪</div>
                        <div className="meta">
                          <div className="name">{g.name}</div>
                          <div className="loc">
                            {g.bands.length ? g.bands.join(', ') : 'guitarist'}
                          </div>
                        </div>
                      </li>
                    );
                  }
                  const g = r.item;
                  const isActive = !selected && !selGuitar && i === 0;
                  return (
                    <li
                      key={`gen-${g.pdfPage}`}
                      className={`general ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        setSelected(null);
                        setSelGuitar(null);
                      }}
                    >
                      <div className="num">§</div>
                      <div className="meta">
                        <div className="name">{g.title}</div>
                        <div className="loc">page {g.printedPage}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <article className="detail">
              <DetailView
                topMatch={topMatch}
                selected={selected}
                selectedGuitarist={selGuitar ? guitaristBySlug[selGuitar] : null}
                onPickAmp={pickAmp}
                onPickCollection={pickCollection}
                tokens={query.trim().toLowerCase().split(/\s+/).filter((t) => t.length >= 2)}
                onZoomImg={setZoomImg}
                device={device}
              />
            </article>
          </section>
        )}
      </main>

      {zoomImg !== null && (
        <div className="zoom" onClick={() => setZoomImg(null)}>
          <img src={IMG_URL(zoomImg)} alt="" />
          <button className="zoom-close" aria-label="close">×</button>
        </div>
      )}

      <footer className="foot">
        <div className="foot-row">
          <span className="foot-label">Source</span>
          <em>Amplifier Library Guide v1</em> · Clayton Welch · Axe-Fx III ·
          compiled from Fractal Wiki + Yek's Guide + FAS forum
        </div>
        <div className="foot-row">
          <span className="foot-label">Live ref</span>
          Wiki sync: <em>{wikiStatus.wikiCount}</em> amps on wiki ·{' '}
          <em>{wikiStatus.guideCount}</em> in this guide ·{' '}
          {wikiStatus.wikiOnly.length > 0 || wikiStatus.guideOnly.length > 0 ? (
            <em>
              {wikiStatus.wikiOnly.length} new on wiki ·{' '}
              {wikiStatus.guideOnly.length} guide-only
            </em>
          ) : (
            <em>in sync</em>
          )}
          {' · '}
          <a
            href={wikiStatus.source}
            target="_blank"
            rel="noreferrer"
          >
            wiki.fractalaudio.com / Amp_models_list
          </a>
        </div>
        <div className="foot-row">
          <span className="foot-label">Support</span>
          <a
            href="https://buymeacoffee.com/rinkashimikito"
            target="_blank"
            rel="noreferrer"
          >
            buy me a coffee
          </a>
          <span className="foot-sep">·</span>
          <a
            href="https://github.com/sponsors/rinkashimikito"
            target="_blank"
            rel="noreferrer"
          >
            github sponsors
          </a>
        </div>
        <div className="foot-row foot-row-fine">
          Numbers in this app reflect Welch's ordering; positions on your unit
          depend on installed firmware. Axe-Fx™ is a trademark of Fractal
          Audio Systems · this app is not affiliated with FAS.
        </div>
      </footer>
    </div>
  );
}

function DeviceGate({ onPick }: { onPick: (d: Device) => void }) {
  return (
    <div className="gate">
      <div className="gate-inner">
        <div className="gate-kicker">First — pick your device</div>
        <h1 className="gate-title">
          What are you running?
        </h1>
        <p className="gate-sub">
          The guide is written for current-generation Fractal hardware. Your
          choice tunes the load instructions and feature notes shown for each
          amp.
        </p>
        <div className="gate-grid">
          <button className="gate-card" onClick={() => onPick('III')}>
            <div className="gate-card-name">Axe-Fx III</div>
            <div className="gate-card-meta">320+ amps · 2 amp blocks · full feature set</div>
          </button>
          <button className="gate-card" onClick={() => onPick('FM9')}>
            <div className="gate-card-name">FM9</div>
            <div className="gate-card-meta">Same amp set as III · 2 amp blocks</div>
          </button>
          <button className="gate-card" onClick={() => onPick('FM3')}>
            <div className="gate-card-name">FM3</div>
            <div className="gate-card-meta">
              Same amp set · 1 amp block · no Bias Tremolo / Input Dynamics
            </div>
          </button>
          <button
            className="gate-card gate-card-ghost"
            onClick={() => onPick('II_AX8')}
          >
            <div className="gate-card-name">Axe-Fx II / AX8</div>
            <div className="gate-card-meta">Older generation</div>
          </button>
        </div>
        <p className="gate-foot">
          Stored locally — change anytime from the header.
        </p>
      </div>
    </div>
  );
}

function OutOfScope({ onBack }: { onBack: () => void }) {
  return (
    <div className="gate">
      <div className="gate-inner">
        <div className="gate-kicker">Out of scope</div>
        <h1 className="gate-title">This guide is current-gen only.</h1>
        <p className="gate-sub">
          Axe-Fx II and AX8 ship with a different (older) amp set. The 331
          entries in this library document the Axe-Fx III / FM9 / FM3 model
          list and won't map to your unit. For II / AX8 use Yek's older guide.
        </p>
        <div className="gate-grid">
          <button className="gate-card" onClick={onBack}>
            <div className="gate-card-name">← Pick a different device</div>
            <div className="gate-card-meta">III · FM9 · FM3</div>
          </button>
        </div>
      </div>
    </div>
  );
}

function AmpUsage({ name }: { name: string }) {
  const u = usageByName[name];
  if (!u) return null;
  const artists = u.usage?.length ? u.usage : null;
  const realAmp = u.realAmp?.trim();
  if (!realAmp && !artists && !u.songs?.length && !u.info?.length) return null;
  return (
    <aside className="usage">
      {realAmp && (
        <>
          <div className="famous-label">Real-world amp</div>
          <p className="usage-real">
            {u.brand && <strong>{u.brand}</strong>}
            {u.brand && ' — '}
            {u.realAmpLink ? (
              <a href={u.realAmpLink} target="_blank" rel="noreferrer">
                {realAmp} ↗
              </a>
            ) : (
              realAmp
            )}
          </p>
        </>
      )}

      {artists && (
        <>
          <div className="famous-label">Used by</div>
          <ul className="usage-list">
            {artists.map((ua, i) => (
              <li key={i}>
                <span className="usage-artist">{ua.artist}</span>
                {ua.links.map((l, j) => (
                  <a
                    key={j}
                    className={`usage-src usage-${l.strength ?? 'weak'}`}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    title={
                      l.supporting_quote
                        ? `${l.title} — "${l.supporting_quote}"`
                        : l.title
                    }
                  >
                    {STRENGTH_GLYPH[l.strength ?? 'weak']}{' '}
                    {(l.strength ?? 'weak') === 'weak' ? 'source (weak)' : 'source'}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}

      {u.songs && u.songs.length > 0 && (
        <>
          <div className="famous-label">Songs / albums</div>
          <ul className="usage-list">
            {u.songs.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {u.songLink && (
            <a
              className="usage-src usage-strong"
              href={u.songLink}
              target="_blank"
              rel="noreferrer"
            >
              ↗ source
            </a>
          )}
        </>
      )}

      {u.info && u.info.length > 0 && (
        <>
          <div className="famous-label">More</div>
          <ul className="usage-list">
            {u.info.map((s, i) => (
              <li key={i}>
                {i === 0 && u.infoLink ? (
                  <a href={u.infoLink} target="_blank" rel="noreferrer">
                    {s} ↗
                  </a>
                ) : (
                  s
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

function AmpTags({
  name,
  onPickCollection,
  onPickAmp,
}: {
  name: string;
  onPickCollection: (key: string) => void;
  onPickAmp: (name: string) => void;
}) {
  const t = tagsByName[name];
  if (!t) return null;
  const gainKey = t.gain && collectionByKey[t.gain] ? t.gain : null;
  const genreKey = (g: string) =>
    g === 'djent' || g === 'metal' ? 'metal' : collectionByKey[g] ? g : null;
  const hasChips = t.gain || (t.genres && t.genres.length > 0);
  if (!hasChips && !(t.variants && t.variants.length)) return null;
  return (
    <div className="amp-tags">
      {hasChips && (
        <div className="amp-tags-row">
          {t.gain &&
            (gainKey ? (
              <button
                className="tag tag-gain"
                onClick={() => onPickCollection(gainKey)}
              >
                {GAIN_LABEL[t.gain] ?? t.gain}
              </button>
            ) : (
              <span className="tag tag-gain">{GAIN_LABEL[t.gain] ?? t.gain}</span>
            ))}
          {(t.genres ?? []).map((g) => {
            const key = genreKey(g);
            return key ? (
              <button key={g} className="tag" onClick={() => onPickCollection(key)}>
                {g}
              </button>
            ) : (
              <span key={g} className="tag">
                {g}
              </span>
            );
          })}
        </div>
      )}
      {t.variants && t.variants.length > 0 && (
        <div className="amp-variants">
          <span className="amp-variants-label">Same real amp</span>
          {t.variants.map((v) => (
            <button
              key={v}
              className="amp-variant-link"
              onClick={() => onPickAmp(v)}
            >
              {v}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GuitaristView({
  g,
  onPickAmp,
}: {
  g: Guitarist;
  onPickAmp: (name: string) => void;
}) {
  return (
    <>
      <header className="detail-head">
        <div>
          <div className="kicker">Guitarist</div>
          <h2>{g.name}</h2>
          {g.bands.length > 0 && <div className="sub">{g.bands.join(' · ')}</div>}
        </div>
      </header>

      <div className="gtr-amps">
        {g.amps.map((amp, i) => (
          <div className="gtr-amp" key={i}>
            <div className="gtr-amp-name">
              {amp.brand && <strong>{amp.brand}</strong>} {amp.model}
            </div>
            <div className="gtr-srcs">
              {amp.links.map((l, j) => (
                <a
                  key={j}
                  className={`usage-src usage-${l.strength ?? 'weak'}`}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  title={
                    l.supporting_quote
                      ? `${l.title} — "${l.supporting_quote}"`
                      : l.title
                  }
                >
                  {STRENGTH_GLYPH[l.strength ?? 'weak']}{' '}
                  {(l.strength ?? 'weak') === 'weak' ? 'source (weak)' : 'source'}
                </a>
              ))}
            </div>
            {amp.libraryAmps.length > 0 && (
              <div className="gtr-lib">
                <span className="gtr-lib-label">In this library:</span>
                {amp.libraryAmps.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="gtr-lib-link"
                    onClick={() => onPickAmp(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="muted gtr-note">
        Gear sourced from public interviews, rig rundowns, and gear databases —
        every link verified. Players change gear; this reflects what's
        documented.
      </p>
    </>
  );
}

function DetailView({
  topMatch,
  selected,
  selectedGuitarist,
  onPickAmp,
  onPickCollection,
  tokens,
  onZoomImg,
  device,
}: {
  topMatch: ResultItem;
  selected: Amp | null;
  selectedGuitarist: Guitarist | null;
  onPickAmp: (name: string) => void;
  onPickCollection: (key: string) => void;
  tokens: string[];
  onZoomImg: (file: string) => void;
  device: Device;
}) {
  const view: ResultItem = selectedGuitarist
    ? { kind: 'guitarist', item: selectedGuitarist, score: 0 }
    : selected
      ? { kind: 'amp', item: selected, score: 0, highlights: [] }
      : topMatch;

  if (view.kind === 'guitarist') {
    return <GuitaristView g={view.item} onPickAmp={onPickAmp} />;
  }

  if (view.kind === 'general') {
    const g = view.item;
    return (
      <>
        <header className="detail-head">
          <div>
            <div className="kicker">Section</div>
            <h2>{g.title}</h2>
            <div className="sub">printed page {g.printedPage}</div>
          </div>
        </header>
        <div className="general-text">
          {g.text.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </>
    );
  }

  const a = view.item;
  const regexes = tokens.map(
    (t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
  );

  const famous = a.body.filter(isFamousBullet);

  return (
    <>
      <header className="detail-head">
        <div>
          <div className="kicker">Amp · {a.num}</div>
          <h2>{a.name}</h2>
          {wikiEntryFor(a.name)?.description && (
            <div className="sub">{wikiEntryFor(a.name)!.description}</div>
          )}
          <a
            className="wiki-link"
            href={wikiUrlFor(a.name)}
            target="_blank"
            rel="noreferrer"
          >
            see on Fractal Wiki ↗
          </a>
        </div>
      </header>

      <div className="load-hint">
        <span className="load-hint-label">Load on {DEVICE_LABELS[device]}</span>
        <code>AMP block → TYPE → {a.name}</code>
      </div>

      {device === 'FM3' && ampHasFm3Caveat(a.body) && (
        <div className="fm3-caveat">
          <span className="fm3-caveat-tag">FM3</span>
          This amp's voicing references Bias Tremolo or Input Dynamics — neither
          is available in the FM3 amp block. Loads and plays, but won't be 1:1 with III/FM9.
        </div>
      )}

      <AmpTags
        name={a.name}
        onPickCollection={onPickCollection}
        onPickAmp={onPickAmp}
      />

      <AmpUsage name={a.name} />

      {famous.length > 0 && (
        <aside className="famous">
          <div className="famous-label">Heard on / associated</div>
          <ul>
            {famous.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </aside>
      )}

      {a.images.length > 0 && (
        <div className="amp-images">
          {a.images.map((file) => (
            <button
              key={file}
              type="button"
              className="amp-image"
              onClick={() => onZoomImg(file)}
              aria-label="zoom"
            >
              <img src={IMG_URL(file)} alt={a.name} loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {a.body.length > 0 ? (
        <ul className="amp-body">
          {highlightAcrossBullets(a.body, regexes)}
        </ul>
      ) : (
        <p className="muted">No description extracted from this entry.</p>
      )}
    </>
  );
}
