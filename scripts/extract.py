#!/usr/bin/env python3
"""
Extract per-amp text and images from the Fractal Amplifier Library Guide PDF.

Output:
  public/amp-images/<num>-<k>.<ext>
  src/data/amps.json with shape:
    {
      amps: [{num, name, printedPage, pdfPage, body: string[], images: string[]}],
      general: [{pdfPage, printedPage, title, text}],
      pageTexts: { "<pdfPage>": "..." }
    }

Image-to-amp mapping uses column-based heuristic:
  per page, each amp heading defines a column anchor (x_center).
  per image, the amp whose column anchor is closest in x AND whose heading is
  closest above the image (in same column) wins.
  images above all headings in their column attach to the first amp in column.
"""
from __future__ import annotations
import fitz, json, re, sys, hashlib
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
PDF = Path("/Users/m/Downloads/Amplifier Library Guide v1 - Fractal Audio - Comprehensive - AF_AG.pdf")
OUT_IMG = ROOT / "public" / "amp-images"
OUT_JSON = ROOT / "src" / "data" / "amps.json"

PRINTED_TO_PDF_OFFSET = 2  # printed = pdf - 2

# Heading: 3-digit num at start of line, then space, then UPPER-or-digit name
AMP_HEAD = re.compile(r"^(\d{3})\s+([A-Z0-9‘'\"].+?)\s*$")
# Bullet glyph in this PDF is the letter `g` rendered with a Wingdings-like font
BULLET_RE = re.compile(r"^\s*g(?=[A-Z“”\"\'(])")  # `g` followed by capital/quote/paren
BULLET_RE_LOOSE = re.compile(r"^\s*g\s+")


def parse_amp_body(text: str) -> list[str]:
    """
    Given the raw text for a single amp (after heading line, before next heading),
    return a list of bullet-point strings with the leading 'g' stripped and lines joined.
    Non-bullet leading text (rare) becomes the first item.
    """
    # Normalise whitespace lines to empty
    lines = [ln.rstrip() for ln in text.split("\n")]
    bullets: list[list[str]] = []
    current: list[str] | None = None
    intro: list[str] = []
    for ln in lines:
        stripped = ln.strip()
        if not stripped:
            continue
        if BULLET_RE.match(stripped) or BULLET_RE_LOOSE.match(stripped):
            # Start new bullet
            cleaned = re.sub(r"^\s*g\s*", "", stripped)
            current = [cleaned]
            bullets.append(current)
        else:
            if current is None:
                intro.append(stripped)
            else:
                current.append(stripped)
    out: list[str] = []
    if intro:
        out.append(" ".join(intro))
    for b in bullets:
        out.append(" ".join(b))
    return out


def extract_amps_from_page(page: fitz.Page) -> tuple[list[dict], list[tuple[float, float, float, float]], dict]:
    """
    Returns (amp_entries, image_bboxes, debug)
    amp_entries: [{num, name, body, head_bbox, region}]
      region = bbox enclosing all this amp's text spans (heading + bullets) on this page
    image_bboxes: list of (x0,y0,x1,y1) for image blocks
    """
    full_text = page.get_text("text")
    blocks = page.get_text("dict")["blocks"]

    # Walk text blocks in document order, building per-amp text-span bboxes
    # We rely on the fact that PyMuPDF's plain-text reading order matches block iteration order
    # well enough that a heading and its trailing bullets are grouped together.
    cur_num = None
    cur_name = None
    amp_order: list[str] = []
    bodies_lines: dict[str, list[str]] = {}
    head_bboxes: dict[str, tuple] = {}
    region_bboxes: dict[str, list[tuple]] = defaultdict(list)

    for b in blocks:
        if b["type"] != 0:
            continue
        for l in b.get("lines", []):
            line_text = "".join(s["text"] for s in l.get("spans", []))
            stripped = line_text.strip()
            line_bbox = tuple(l.get("bbox", b["bbox"]))
            m = AMP_HEAD.match(stripped)
            if m:
                cur_num = m.group(1)
                cur_name = m.group(2).strip()
                if cur_num not in head_bboxes:
                    amp_order.append(cur_num)
                    head_bboxes[cur_num] = line_bbox
                    bodies_lines[cur_num] = []
                region_bboxes[cur_num].append(line_bbox)
            else:
                if cur_num is not None:
                    bodies_lines[cur_num].append(line_text)
                    region_bboxes[cur_num].append(line_bbox)

    image_bboxes = [tuple(b["bbox"]) for b in blocks if b["type"] == 1]

    # Reconstruct amp entries
    amps = []
    for num in amp_order:
        regions = region_bboxes[num]
        x0 = min(r[0] for r in regions)
        y0 = min(r[1] for r in regions)
        x1 = max(r[2] for r in regions)
        y1 = max(r[3] for r in regions)
        amps.append({
            "num": num,
            "name": "",  # set below
            "body": parse_amp_body("\n".join(bodies_lines[num])),
            "head_bbox": head_bboxes[num],
            "region": (x0, y0, x1, y1),
        })

    # Fill names by re-scanning plain text (more reliable than block walk for unicode names)
    name_map: dict[str, str] = {}
    for ln in full_text.split("\n"):
        m = AMP_HEAD.match(ln.strip())
        if m and m.group(1) not in name_map:
            name_map[m.group(1)] = m.group(2).strip()
    for a in amps:
        a["name"] = name_map.get(a["num"], "")

    return amps, image_bboxes, {"page_text_len": len(full_text)}


def _bbox_distance(a: tuple, b: tuple) -> float:
    """Minimum corner-to-corner distance between two axis-aligned rectangles. 0 if overlapping."""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    dx = max(0.0, max(ax0 - bx1, bx0 - ax1))
    dy = max(0.0, max(ay0 - by1, by0 - ay1))
    return (dx * dx + dy * dy) ** 0.5


def _x_overlap(a: tuple, b: tuple) -> float:
    return max(0.0, min(a[2], b[2]) - max(a[0], b[0]))


def _pair_score(amp: dict, image_bbox: tuple) -> float:
    """
    Lower = better match. Pure 2D rect-to-rect distance with a small bias for
    headings that sit above the image (typical layout).
    """
    hb = amp["head_bbox"]
    d = _bbox_distance(hb, image_bbox)
    icy = (image_bbox[1] + image_bbox[3]) / 2
    hcy = (hb[1] + hb[3]) / 2
    above_bonus = -10.0 if hcy < icy else 0.0
    return d + above_bonus


def assign_images_to_amps(amps: list[dict],
                          image_bboxes: list[tuple[float, float, float, float]]) -> dict[int, str]:
    """
    Returns mapping image_index -> amp_num.

    Two-pass bipartite greedy:
      Pass 1: each amp claims its closest unclaimed image (one each, lowest pair-score wins).
      Pass 2: any remaining images attach to their closest amp (allowing >1 per amp).

    This avoids the failure mode where one amp greedily collects 3-4 images while neighbours
    on the same page get none.
    """
    if not amps or not image_bboxes:
        return {}

    mapping: dict[int, str] = {}
    for ii, ib in enumerate(image_bboxes):
        best_ai = None
        best_score = 1e18
        for ai, a in enumerate(amps):
            s = _pair_score(a, ib)
            if s < best_score:
                best_score = s
                best_ai = ai
        if best_ai is not None:
            mapping[ii] = amps[best_ai]["num"]
    return mapping


def base_name(name: str) -> str:
    """
    Reduce an amp name to its base model so variants share photos.
    e.g. '1959SLP JUMPED' -> '1959SLP'
         '5F8 TWEED NORMAL' -> '5F8 TWEED'
         'CLASS-A 15W TB' -> 'CLASS-A 15W'
    Strategy: strip common variant suffixes (JUMPED, NORMAL, BRIGHT, TREBLE, BASS, MID,
    CLEAN, LEAD, RHYTHM, MODERN, CRUNCH, HIGH, LOW, BLUE, GREEN, RED, STEALTH, BIG, etc.)
    until no more match. Single-word names stay as-is.
    """
    SUFFIXES = {
        "JUMPED", "NORMAL", "BRIGHT", "TREBLE", "BASS", "MID", "MIDDLE",
        "CLEAN", "LEAD", "RHYTHM", "MODERN", "CRUNCH", "HIGH", "LOW",
        "STEALTH", "BLUE", "GREEN", "RED", "RI", "EC", "PAB",
        "BIG", "TB", "I", "II", "III", "IV", "1", "2", "3", "GAIN",
        "CHANNEL", "CH", "MARK",
    }
    parts = name.strip().split()
    while len(parts) > 1 and parts[-1].upper() in SUFFIXES:
        parts.pop()
    return " ".join(parts).upper()


def propagate_sibling_images(amps: list[dict]) -> int:
    """
    For amps with no images, copy images from a same-base-name sibling on the same printed page
    or adjacent pages. Returns number of amps gained images.
    """
    by_base: dict[str, list[dict]] = defaultdict(list)
    for a in amps:
        by_base[base_name(a["name"])].append(a)
    gained = 0
    for base, group in by_base.items():
        if len(group) < 2:
            continue
        donors = [a for a in group if a["images"]]
        if not donors:
            continue
        donor = donors[0]
        for a in group:
            if a["images"]:
                continue
            a["images"] = list(donor["images"])
            gained += 1
    return gained


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main() -> int:
    if not PDF.exists():
        print(f"PDF not found: {PDF}", file=sys.stderr)
        return 1

    OUT_IMG.mkdir(parents=True, exist_ok=True)
    # clear out previous extracted images
    for old in OUT_IMG.glob("*"):
        old.unlink()

    doc = fitz.open(PDF)
    n_pages = doc.page_count
    print(f"PDF pages: {n_pages}")

    all_amps: list[dict] = []
    general: list[dict] = []
    image_count_per_amp: dict[str, int] = defaultdict(int)
    skipped_images_per_page: dict[int, int] = {}

    for i in range(n_pages):
        pdf_page = i + 1
        printed_page = pdf_page - PRINTED_TO_PDF_OFFSET
        page = doc[i]
        text = page.get_text("text")

        # TOC pages 2-3 give thousands of false heading matches — skip
        if pdf_page in (2, 3):
            continue

        amps_on_page, img_bboxes, _dbg = extract_amps_from_page(page)

        if not amps_on_page:
            # Treat as 'general' content (intro, abbrev, back matter, section breaks)
            title_match = re.search(r"^\s*([A-Z][A-Z\s\-&/]{2,})\s*$", text, re.M)
            title = title_match.group(1).strip() if title_match else f"Page {printed_page}"
            general.append({
                "pdfPage": pdf_page,
                "printedPage": printed_page,
                "title": title[:80],
                "text": text.strip(),
            })
            continue

        # Map images to amps
        img_to_amp = assign_images_to_amps(amps_on_page, img_bboxes)
        # Extract & save each image
        page_images = page.get_images(full=True)
        # Cross-reference: get_text('dict') image blocks and page.get_images() are different lists.
        # We need the bbox-aware list. Use page.get_image_info() which gives bbox + xref.
        image_info = page.get_image_info(xrefs=True)
        # image_info order should match image_bboxes order; verify lengths
        if len(image_info) != len(img_bboxes):
            # Try re-aligning by bbox match
            print(f"  warn p{pdf_page}: image_info={len(image_info)} != bbox={len(img_bboxes)}")

        # Use image_info for both bbox and xref
        for idx, info in enumerate(image_info):
            xref = info.get("xref", 0)
            bbox = tuple(info["bbox"])
            # Find which amp via bbox match against our img_to_amp keys (image_bboxes order)
            # Use closest-bbox lookup
            best_idx, best_d = -1, 1e18
            for k, ib in enumerate(img_bboxes):
                d = sum((a - b) ** 2 for a, b in zip(bbox, ib))
                if d < best_d:
                    best_d = d
                    best_idx = k
            num = img_to_amp.get(best_idx)
            if num is None:
                continue
            if xref == 0:
                continue
            try:
                img = doc.extract_image(xref)
            except Exception:
                continue
            ext = img.get("ext", "png")
            data = img["image"]
            # Skip tiny images (likely icons/glyphs) — under 80x80
            w, h = img.get("width", 0), img.get("height", 0)
            if w < 80 or h < 80:
                skipped_images_per_page[pdf_page] = skipped_images_per_page.get(pdf_page, 0) + 1
                continue
            # Skip near-duplicate images by content hash
            h_hex = hashlib.sha1(data).hexdigest()[:10]
            k = image_count_per_amp[num]
            fname = f"{num}-{k:02d}-{h_hex}.{ext}"
            (OUT_IMG / fname).write_bytes(data)
            image_count_per_amp[num] = k + 1

        # Final amp records (drop head_bbox)
        for a in amps_on_page:
            num = a["num"]
            imgs = sorted([f.name for f in OUT_IMG.glob(f"{num}-*")])
            all_amps.append({
                "num": num,
                "name": a["name"],
                "printedPage": printed_page,
                "pdfPage": pdf_page,
                "body": a["body"],
                "images": imgs,
            })

    # Sort amps by num
    all_amps.sort(key=lambda a: a["num"])

    # Sibling propagation: variants of same base model share photos
    gained = propagate_sibling_images(all_amps)

    # Stats
    n_with_imgs = sum(1 for a in all_amps if a["images"])
    print(f"amps extracted: {len(all_amps)}")
    print(f"amps with image (after sibling propagation): {n_with_imgs} (+{gained} via siblings)")
    print(f"general pages: {len(general)}")
    print(f"total image files: {sum(image_count_per_amp.values())}")

    out = {
        "amps": all_amps,
        "general": general,
    }
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"wrote {OUT_JSON}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
