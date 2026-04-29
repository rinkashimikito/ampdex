"""
Fetch the Fractal Audio Wiki amp models list, extract amp names + descriptions,
and compare against our compiled data (src/data/amps.json — sourced from Welch
v1). Writes src/data/wiki-status.json with delta info for the UI to show.

Run from repo root:  python3 scripts/wiki_sync.py
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WIKI_URL = "https://wiki.fractalaudio.com/wiki/index.php?title=Amp_models_list"
USER_AGENT = (
    "Mozilla/5.0 (compatible; ampdex-sync/1.0; "
    "+https://github.com/rinkashimikito/ampdex)"
)

REPO = Path(__file__).resolve().parents[1]
AMPS_JSON = REPO / "src" / "data" / "amps.json"
STATUS_JSON = REPO / "src" / "data" / "wiki-status.json"


def fetch_wiki() -> str:
    req = urllib.request.Request(WIKI_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_amps(html: str) -> list[dict]:
    """
    The wiki page uses <h2> per amp. Each heading text is either:
      "AMP NAME"
    or
      "AMP NAME (description)"
    We capture both, drop the table-of-contents heading, and dedupe.
    """
    amps: list[dict] = []
    seen: set[str] = set()
    # Non-amp H2s on the wiki page that should be skipped
    skip = {"contents", "navigation menu", "personal tools", "namespaces", "views"}
    for m in re.finditer(r"<h2[^>]*>(.*?)</h2>", html, re.DOTALL):
        raw = re.sub(r"<[^>]+>", "", m.group(1)).strip()
        # Strip MediaWiki [edit] suffix if present
        raw = re.sub(r"\s*\[\s*edit\s*\]\s*$", "", raw, flags=re.I)
        if not raw or raw.lower() in skip:
            continue
        # Split "NAME (description)" — outer parens only
        desc_match = re.match(r"^([^()]+?)\s*\((.+)\)\s*$", raw)
        if desc_match:
            name = desc_match.group(1).strip()
            description = desc_match.group(2).strip()
        else:
            name = raw
            description = ""
        key = name.upper()
        if key in seen:
            continue
        seen.add(key)
        amps.append({"name": name, "description": description})
    return amps


def normalize(s: str) -> str:
    s = s.strip().upper()
    # Curly quotes → straight, em/en dash → hyphen
    s = (
        s.replace("‘", "'")
        .replace("’", "'")
        .replace("“", '"')
        .replace("”", '"')
        .replace("–", "-")
        .replace("—", "-")
    )
    # Drop leading apostrophe (Welch writes '59, wiki writes 59)
    s = re.sub(r"^'+", "", s)
    # Collapse spaces around slash and dash, then collapse all whitespace
    s = re.sub(r"\s*([/\-])\s*", r"\1", s)
    s = re.sub(r"\s+", " ", s)
    return s


def main() -> int:
    if not AMPS_JSON.exists():
        print(f"missing {AMPS_JSON}", file=sys.stderr)
        return 2

    print(f"fetching {WIKI_URL}")
    html = fetch_wiki()
    print(f"  {len(html):,} bytes")

    wiki_amps = extract_amps(html)
    print(f"wiki: {len(wiki_amps)} amps")

    with AMPS_JSON.open() as f:
        guide = json.load(f)
    guide_amps = guide.get("amps", [])
    guide_names = {normalize(a["name"]) for a in guide_amps}
    print(f"guide: {len(guide_amps)} amps")

    wiki_names = {normalize(a["name"]): a for a in wiki_amps}
    wiki_only = sorted(
        [a for k, a in wiki_names.items() if k not in guide_names],
        key=lambda x: x["name"],
    )
    guide_only = sorted(
        [a["name"] for a in guide_amps if normalize(a["name"]) not in wiki_names],
    )

    status = {
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": WIKI_URL,
        "guideCount": len(guide_amps),
        "wikiCount": len(wiki_amps),
        "wikiOnly": wiki_only,
        "guideOnly": guide_only,
    }

    # Pretty-print, stable order
    new_text = json.dumps(status, indent=2, ensure_ascii=False) + "\n"
    old_text = STATUS_JSON.read_text() if STATUS_JSON.exists() else ""

    # Strip the timestamp before comparing — only flag substantive diffs
    def strip_ts(t: str) -> str:
        return re.sub(r'"fetchedAt":\s*"[^"]+",?\s*\n?', "", t)

    if strip_ts(new_text) == strip_ts(old_text):
        print("no substantive change (only timestamp)")
        return 0

    STATUS_JSON.write_text(new_text)
    print(f"wrote {STATUS_JSON.relative_to(REPO)}")
    print(f"  wiki-only: {len(wiki_only)}")
    print(f"  guide-only: {len(guide_only)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
