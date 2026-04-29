# Ampdex — Searchable Axe-Fx Amp Library

A type-driven, keyboard-first reference for the **331 amplifier models** in
**Fractal Audio Axe-Fx III, FM9, and FM3**. Search by amp name, player,
tone, or tube. Find what to load on your unit — fast.

**Live:** https://rinkashimikito.github.io/ampdex/

## What it is

A static web app that wraps **Clayton Welch's *Amplifier Library Guide v1***
(an Axe-Fx III reference) in a fuzzy-searchable interface, with per-amp
"how to load on your device" instructions and FM3 feature-caveat detection.

- **Search** by amp name (`5150`, `plexi`), player (`hendrix`, `clapton`),
  tone (`clean`, `brown`), tube (`6L6`, `EL34`), or amp number (`026`).
- **Brand aliases** — type `marshall`, `mesa`, `vox ac30`, `jcm800`, etc.
  and reach the right model in Welch's `BRIT/USA/CLASS-A` naming.
- **Device gate** — pick Axe-Fx III / FM9 / FM3 once; the load-hint adapts.
- **FM3 caveats** flagged on amps whose voicing relies on Bias Tremolo or
  Input Dynamics (not available in the FM3 amp block).
- **Heard on / associated** callout pulls famous-player & song mentions
  from Welch's bullets so iconic uses surface above the fold.

## Why

The Welch PDF is excellent reference material but slow to navigate.
Yek's guide is more thorough but Word-format. The Fractal Wiki is the
authoritative live source. Ampdex bundles Welch's compiled text into a
search interface so you can answer "**what amp do I pick to get *that*
tone?**" in a few keystrokes.

## Compatibility

| Device | Amp models | Notes |
|---|---|---|
| Axe-Fx III | All 331 | Source guide written for this unit. |
| FM9 | All 331 | Identical Cygnus engine. Names map 1:1. |
| FM3 | All 331 | Same engine. Per-amp warnings for Bias Tremolo / Input Dynamics. |
| Axe-Fx II / AX8 | n/a | Older generation, different amp list. Use Yek's older guide. |

Latest Axe-Fx III firmware referenced: **32.04 (Cygnus X-3)**.
For the canonical, live amp list, see the
[Fractal Audio Wiki — Amp models list](https://wiki.fractalaudio.com/wiki/index.php?title=Amp_models_list).

## Stack

- React 19 + TypeScript + Vite
- [Fuse.js](https://www.fusejs.io/) for fuzzy matching
- [Geist Sans + Geist Mono](https://vercel.com/font) (Vercel)
- Static deploy → GitHub Pages

## Local development

```bash
npm install
npm run dev          # http://localhost:5173/ampdex/
npm run build
npm run preview
```

## Data source & credits

- **Clayton Welch** — *Amplifier Library Guide v1* (compiled from Yek's
  guide + Fractal Wiki + FAS forum + Cliff's tech notes).
- **Fractal Audio Systems** — Axe-Fx, FM9, FM3 hardware and Cygnus amp
  modeling. Axe-Fx™ is a registered trademark of Fractal Audio Systems.
  Ampdex is **not affiliated with FAS**.

## Support

If this saved you time on a session, you can
[buy me a coffee](https://buymeacoffee.com/rinkashimikito).

## License

Code: MIT. Underlying amp content is Welch's compiled work and the original
manufacturers'; no implied license over the source material.

---

**Tags:** `axe-fx` `axe-fx-iii` `fm3` `fm9` `fractal-audio` `cygnus`
`guitar-amps` `amp-modeling` `amp-library` `tone-search` `react` `vite`
