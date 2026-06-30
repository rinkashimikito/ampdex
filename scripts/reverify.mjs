/**
 * Monthly re-verification of guitarist → library amp connections.
 *
 * For every guitarist amp in src/data/guitarists.json with no `libraryAmps`,
 * ask Claude (with live web search/fetch) whether its real-world amp is now
 * modeled in the Fractal library, and map it to the catalog model name(s) that
 * emulate the SAME real amp. Never invents a model name — every result is
 * validated against the actual catalog keys before being written.
 *
 * Factual only: a connection is added only when the model can verify it; the
 * genuine non-matches (Laney, Randall, Polytone, …) stay empty, which the UI
 * renders as "Not modeled in this library".
 *
 * Runs in CI (see .github/workflows/reverify.yml); needs ANTHROPIC_API_KEY.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

const GUITARISTS = 'src/data/guitarists.json';
const TAGS = 'src/data/amp-tags.json';
const MODEL = 'claude-opus-4-8';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const guitarists = JSON.parse(readFileSync(GUITARISTS, 'utf8'));
const tags = JSON.parse(readFileSync(TAGS, 'utf8'));

// catalog: model name -> real-world amp it models
const catalogNames = new Set(Object.keys(tags));
const catalogText = Object.entries(tags)
  .map(([name, t]) => `${name} :: ${t.realAmp ?? ''}`)
  .join('\n');

const SYSTEM = `You map a guitarist's real-world amplifiers to the Fractal Audio amp models that emulate them. Be precise; never guess. Use web_search / web_fetch to confirm what a guitarist actually plays. Only map to a catalog model when its real-world amp is the SAME real amp (or the direct real-world basis) the guitarist uses. If the real amp is not in the catalog (e.g. Laney, Randall, Polytone, Schecter, Carvin), return an empty list — that is the correct, expected answer. Never output a model name that is not an exact catalog key.`;

const tool = (s) => s.trim();

async function mapGuitarist(g) {
  const ampsList = g.amps
    .map((a, i) => `${i}. ${a.brand} ${a.model}`)
    .join('\n');
  const prompt = tool(`Fractal amp catalog (one per line — "MODEL NAME :: real-world amp modeled"):
${catalogText}

Guitarist: ${g.name}${g.bands?.length ? ` (${g.bands.join(', ')})` : ''}
Their amps:
${ampsList}

For each amp index, verify via web search what real amp it is, then list the catalog MODEL NAMEs (left of "::") whose real-world amp is the same real amp. Use only exact catalog names; [] when none is modeled.

Reply with ONLY a JSON array (no prose, no fences):
[{"index":0,"libraryAmps":["<exact catalog name>", ...]}]`);

  const messages = [{ role: 'user', content: prompt }];
  const tools = [
    { type: 'web_search_20260209', name: 'web_search' },
    { type: 'web_fetch_20260209', name: 'web_fetch' },
  ];

  // server-side tool loop: re-send on pause_turn until the model finishes
  let resp;
  for (let i = 0; i < 8; i++) {
    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      tools,
      messages,
    });
    if (resp.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: resp.content });
  }

  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return false;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return false;
  }

  let changed = false;
  for (const row of parsed) {
    const amp = g.amps[row.index];
    if (!amp || amp.libraryAmps?.length) continue;
    const libs = (row.libraryAmps ?? []).filter((n) => catalogNames.has(n)).slice(0, 6);
    if (libs.length) {
      amp.libraryAmps = libs;
      changed = true;
      console.log(`  + ${g.name} / ${amp.brand} ${amp.model} -> ${libs.join(', ')}`);
    }
  }
  return changed;
}

const pending = guitarists.filter((g) => g.amps.some((a) => !a.libraryAmps?.length));
console.log(`Re-verifying ${pending.length} guitarist(s) with unmapped amps...`);

let any = false;
for (const g of pending) {
  try {
    if (await mapGuitarist(g)) any = true;
  } catch (e) {
    console.error(`  ! ${g.name}: ${e.message}`);
  }
}

if (any) {
  writeFileSync(GUITARISTS, JSON.stringify(guitarists, null, 2) + '\n');
  console.log('guitarists.json updated.');
} else {
  console.log('No new connections — nothing changed.');
}
