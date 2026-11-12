#!/usr/bin/env python3
"""Generate docs/decisions/README.md, the index of recorded decisions.

Usage:
    python3 scripts/decisions-index.py           write docs/decisions/README.md
    python3 scripts/decisions-index.py --check   exit 1 if the index is stale

Each file docs/decisions/<stem>.md listed in DOMAINS holds one `##` heading
per decision, followed by a `Status:` line. The index has one table per
domain, in DOMAINS order: decision (linked by heading anchor), file, status.

Exit codes:
    0  index written, or (with --check) the index is up to date
    1  a decision file is malformed; with --check also: the index is stale,
       a decision file is not listed in DOMAINS, or a listed domain has no file

Standard library only. scripts/check-docs.py imports this file for its
Markdown helpers (scan, headings, anchors, slugify) and for check().
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import unicodedata
from dataclasses import dataclass
from typing import List, Mapping, Optional, Sequence, Tuple

# File stem in docs/decisions/ -> section title in the index, in index order.
DOMAINS = {
    "docs": "Documentation contract",
}

DECISIONS_DIR = "docs/decisions"
INDEX_NAME = "README.md"
GENERATOR = "scripts/decisions-index.py"

STATUS_RE = re.compile(r"^Status: (decided|postponed|superseded)(?: \((#\d+(?:, #\d+)*)\))?\s*$")

_FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_ATX_RE = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$")
_SETEXT_RE = re.compile(r"^ {0,3}(=+|-+)[ \t]*$")
_NOT_PARAGRAPH_RE = re.compile(r"^ {0,3}(?:[-*+>|]|\d+[.)]|#)")
_HTML_ID_RE = re.compile(r"""<[a-zA-Z][^>]*?\s(?:id|name)\s*=\s*["']([^"']+)["']""")


# --------------------------------------------------------------------------
# Markdown helpers, shared with scripts/check-docs.py
# --------------------------------------------------------------------------

def scan(text: str) -> List[Tuple[int, str, str]]:
    """Split Markdown into (line number, line, kind) with kind "text", "code"
    (inside a fenced block, fence lines included) or "front" (YAML front
    matter at the top of the file)."""
    lines = text.splitlines()
    out: List[Tuple[int, str, str]] = []
    i = 0
    if lines and lines[0].strip() == "---":
        for j in range(1, len(lines)):
            if lines[j].strip() in ("---", "..."):
                for k in range(0, j + 1):
                    out.append((k + 1, lines[k], "front"))
                i = j + 1
                break
    fence: Optional[str] = None
    for n in range(i, len(lines)):
        line = lines[n]
        if fence is None:
            m = _FENCE_RE.match(line)
            if m:
                fence = m.group(1)
                out.append((n + 1, line, "code"))
                continue
            out.append((n + 1, line, "text"))
        else:
            out.append((n + 1, line, "code"))
            stripped = line.strip()
            if (stripped and set(stripped) == {fence[0]} and len(stripped) >= len(fence)
                    and len(line) - len(line.lstrip(" ")) <= 3):
                fence = None
    return out


_CODE_SPAN_RE = re.compile(r"(`+)(.+?)\1")


def code_span_text(content: str) -> str:
    """A code span's text as CommonMark renders it: one space comes off each
    end when both ends have one and the content is not only spaces."""
    if len(content) >= 2 and content[0] == " " and content[-1] == " " and content.strip(" "):
        return content[1:-1]
    return content


def plain_heading_text(text: str) -> str:
    """Reduce inline Markdown in a heading to the text GitHub renders. Code
    spans keep their content literally (`<T>` stays <T>, `_x` stays _x), also
    inside link text ([`x`](y.md) is x)."""
    spans: List[str] = []

    def hide(m: re.Match) -> str:
        spans.append(code_span_text(m.group(2)))
        return f"\0{len(spans) - 1}\0"

    text = _CODE_SPAN_RE.sub(hide, text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]*)\]\[[^\]]*\]", r"\1", text)
    text = re.sub(r"<[^>\0]+>", "", text)
    text = re.sub(r"[*~]+", "", text)
    text = re.sub(r"(?<![\w\0])_+|_+(?![\w\0])", "", text)
    text = re.sub(r"\0(\d+)\0", lambda m: spans[int(m.group(1))], text)
    return text.strip()


def slugify(text: str) -> str:
    """GitHub's anchor for a heading (without the -1, -2 suffix for duplicates)."""
    out = []
    for ch in plain_heading_text(text).lower():
        if ch.isalnum() or ch in "-_ " or unicodedata.category(ch) in ("Mn", "Mc", "Nd", "Pc"):
            out.append("-" if ch == " " else ch)
    return "".join(out)


@dataclass(frozen=True)
class Heading:
    level: int
    text: str
    slug: str
    line: int       # line number of the heading text
    end_line: int   # last line of the heading (the underline for setext)


def headings(text: str) -> List[Heading]:
    """All ATX and setext headings outside fenced code and front matter,
    with GitHub's unique anchors."""
    raw: List[Tuple[int, str, int, int]] = []
    rows = scan(text)
    for idx, (n, line, kind) in enumerate(rows):
        if kind != "text":
            continue
        m = _ATX_RE.match(line)
        if m:
            raw.append((len(m.group(1)), (m.group(2) or "").strip(), n, n))
            continue
        m = _SETEXT_RE.match(line)
        if m and idx > 0:
            pn, prev, pkind = rows[idx - 1]
            if (pkind == "text" and prev.strip() and not _NOT_PARAGRAPH_RE.match(prev)
                    and not _SETEXT_RE.match(prev) and not (raw and raw[-1][2] == pn)):
                raw.append((1 if m.group(1)[0] == "=" else 2, prev.strip(), pn, n))
    seen: dict = {}
    result: List[Heading] = []
    for level, htext, n, end in raw:
        base = slugify(htext)
        count = seen.get(base, 0)
        slug = base if count == 0 else f"{base}-{count}"
        seen[base] = count + 1
        result.append(Heading(level, htext, slug, n, end))
    return result


def anchors(text: str) -> set:
    """Every anchor a link into this Markdown file may use."""
    found = {h.slug for h in headings(text)}
    for _, line, kind in scan(text):
        if kind == "text":
            found.update(_HTML_ID_RE.findall(line))
    return found


# --------------------------------------------------------------------------
# Decisions
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Decision:
    heading: str
    slug: str
    status: str
    refs: Optional[str]


def parse_decisions(text: str, name: str) -> Tuple[List[Decision], List[str]]:
    """Every `##` heading in a decision file, with the Status line under it."""
    lines = text.splitlines()
    decisions: List[Decision] = []
    errors: List[str] = []
    for h in headings(text):
        if h.level != 2:
            continue
        status_line = None
        for k in range(h.end_line, len(lines)):
            if lines[k].strip():
                status_line = lines[k]
                break
        m = STATUS_RE.match(status_line or "")
        if not m:
            errors.append(
                f"{name}:{h.line}: decision '{h.text}' needs 'Status: decided|postponed|superseded (#N)' "
                f"as the first line under the heading, found: {status_line!r}")
            continue
        decisions.append(Decision(h.text, h.slug, m.group(1), m.group(2)))
    return decisions, errors


def _cell(text: str) -> str:
    return text.replace("|", "\\|")


def _link_text(text: str) -> str:
    return _cell(text).replace("[", "\\[").replace("]", "\\]")


def render(root: str, domains: Mapping[str, str] = DOMAINS) -> Tuple[str, List[str]]:
    """The index text, and the errors found in the decision files."""
    out = [
        "# Decisions index",
        "",
        f"Generated by `{GENERATOR}`, do not edit by hand. Run `make decisions-index` after changing "
        "a file in this directory.",
        "",
        "Read this index before deciding anything: it tells you cheaply whether the question was "
        "already settled. How to record a decision: "
        "[documentation guide](../guides/documentation.md#decisions).",
    ]
    errors: List[str] = []
    for stem, title in domains.items():
        path = os.path.join(root, DECISIONS_DIR, f"{stem}.md")
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as f:
            decisions, errs = parse_decisions(f.read(), f"{DECISIONS_DIR}/{stem}.md")
        errors.extend(errs)
        out += ["", f"## {title}", ""]
        if not decisions:
            out.append("No decisions yet.")
            continue
        out += ["| Decision | File | Status |", "| --- | --- | --- |"]
        for d in decisions:
            status = d.status + (f" ({d.refs})" if d.refs else "")
            out.append(f"| [{_link_text(d.heading)}]({stem}.md#{d.slug}) | [{stem}.md]({stem}.md) | {status} |")
    return "\n".join(out) + "\n", errors


def check(root: str, domains: Mapping[str, str] = DOMAINS) -> List[str]:
    """Problems that make the index wrong; empty when it is up to date."""
    problems: List[str] = []
    ddir = os.path.join(root, DECISIONS_DIR)
    present = set()
    if os.path.isdir(ddir):
        present = {f[:-3] for f in os.listdir(ddir) if f.endswith(".md") and f != INDEX_NAME}
    for stem in sorted(present - set(domains)):
        problems.append(f"{DECISIONS_DIR}/{stem}.md is not listed in DOMAINS in {GENERATOR}")
    for stem in domains:
        if stem not in present:
            problems.append(f"DOMAINS in {GENERATOR} lists '{stem}', but {DECISIONS_DIR}/{stem}.md does not exist")
    text, errors = render(root, domains)
    problems.extend(errors)
    index = os.path.join(ddir, INDEX_NAME)
    current = None
    if os.path.isfile(index):
        with open(index, encoding="utf-8") as f:
            current = f.read()
    if current != text:
        problems.append(f"{DECISIONS_DIR}/{INDEX_NAME} is stale: run `make decisions-index`")
    return problems


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(argv: Optional[Sequence[str]] = None, root: Optional[str] = None) -> int:
    parser = argparse.ArgumentParser(description="Generate or check docs/decisions/README.md.")
    parser.add_argument("--check", action="store_true", help="exit 1 if the index is stale")
    args = parser.parse_args(argv)
    root = root or _repo_root()
    if args.check:
        problems = check(root)
        for p in problems:
            print(f"decisions-index: {p}")
        if not problems:
            print(f"decisions-index: {DECISIONS_DIR}/{INDEX_NAME} is up to date")
        return 1 if problems else 0
    text, errors = render(root)
    if errors:
        for e in errors:
            print(f"decisions-index: {e}")
        return 1
    with open(os.path.join(root, DECISIONS_DIR, INDEX_NAME), "w", encoding="utf-8") as f:
        f.write(text)
    count = sum(1 for line in text.splitlines() if line.startswith("| ["))
    print(f"decisions-index: wrote {DECISIONS_DIR}/{INDEX_NAME} ({count} decisions)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
