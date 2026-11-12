#!/usr/bin/env python3
"""Documentation contract check: every behaviour change carries its documentation.

Usage:
    python3 scripts/check-docs.py [--base REF] [-v]
    python3 scripts/check-docs.py --integrity-only
    make docs-check [BASE=REF] [ARGS=...]

The check compares the working tree with the merge base of HEAD and the base
branch (--base REF; by default origin/main, else main). The changed set is
the union of the commits since the merge base, staged and unstaged changes,
and untracked files that git does not ignore. For every rule in RULES whose
source regex matches a changed path, some changed path must match the rule's
documentation regex. The catch-all rule (F0) matches the paths that no other
rule owns and needs a feature document that is new since the merge base.

Paths that match EXCLUDE (tests, docs, agent tooling, ...) and files whose
diff only changes versions (BUMP_FILTERS) are left out of the source side.
Integrity checks on the whole tree run every time: relative links and
anchors, references to docs/ in code comments, no line-number references,
section citations, the decisions index, the ownership-map tables in
docs/features/README.md against RULES and EXCLUDE, and docs/invariants.md.

Exit codes:
    0  every changed path has its documentation and the integrity checks pass
       (with --integrity-only: the integrity checks pass; no base is needed)
    1  at least one rule or integrity check failed
    2  no base: neither the --base ref nor origin/main nor main exists, there
       is no merge base, or git failed

Environment:
    SKIP_DOCS_CHECK=1  skip the check locally (work in progress). Ignored, with
                       a message, when CI is set.

Standard library only. How to write the documentation: docs/guides/documentation.md.
How this script works: docs/features/docs-contract-technical.md.
"""
from __future__ import annotations

import argparse
import ast
import functools
import importlib.util
import os
import posixpath
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple
from urllib.parse import unquote


@dataclass(frozen=True)
class Rule:
    id: str
    source: str
    docs: str
    message: str
    catch_all: bool = False


# The ownership map. Source of truth; docs/features/README.md restates it and
# this script fails when the two differ. AGENTS.md restates it for agents.
RULES: List[Rule] = [
    Rule(
        "F0",
        r".*",
        r"^docs/features/[^/]+-(user|technical)\.md$",
        "Path owned by no rule: add new feature documents (docs/features/NAME-user.md and "
        "docs/features/NAME-technical.md) and add the path to the ownership map",
        catch_all=True,
    ),
    Rule(
        "F1",
        r"^scripts/(check-docs|decisions-index)\.py$",
        r"^(docs/features/docs-contract-(user|technical)\.md|docs/guides/documentation\.md|AGENTS\.md)$",
        "Documentation check or decisions index changed: update docs/features/docs-contract-technical.md "
        "(or docs/features/docs-contract-user.md, docs/guides/documentation.md), and AGENTS.md if RULES changed",
    ),
    Rule(
        "C1",
        r"^Makefile$",
        r"^docs/guides/(development|testing)\.md$",
        "Build targets changed: update docs/guides/development.md (or docs/guides/testing.md for the test target)",
    ),
    Rule(
        "C2",
        r"^\.github/(?!pull_request_template\.md$)",
        r"^docs/guides/development\.md$",
        "CI or GitHub configuration changed: update docs/guides/development.md",
    ),
]

# Paths left out of the source side on purpose: (regex, why). Their changes
# never require documentation; they still count on the documentation side.
EXCLUDE: List[Tuple[str, str]] = [
    (r"^tests/", "Test code and test data: they describe behaviour, they do not change it"),
    (r"(^|/)[^/]+\.(test|spec)\.[^/]+$", "Test files kept next to the code they test"),
    (r"(^|/)([^/]+\.lock|package-lock\.json|pnpm-lock\.yaml|go\.sum)$",
     "Lock files: generated from a manifest that a rule owns"),
    (r"^(LICEN[CS]E|COPYING)([.-][^/]*)?$", "Licence"),
    (r"^\.gitignore$", "Git ignore list"),
    (r"^docs/", "Documentation"),
    (r"^README\.md$", "Root README, an entry point into docs/"),
    (r"^(AGENTS|CLAUDE)\.md$", "Agent instructions; CLAUDE.md is a symlink to AGENTS.md"),
    (r"^CONTRIBUTING\.md$", "Contribution rules"),
    (r"^\.github/pull_request_template\.md$", "Pull request template"),
    (r"^\.(agents|claude)/", "Agent tooling: skills and agent settings"),
]

# Files whose diff may change only versions: (path regex, line regex). A
# line regex marks the version with the group `v`, and may mark a trailing
# comment that also holds the version with the group `c`. A pin that the
# documentation states must not match the line regex.
BUMP_FILTERS: List[Tuple[str, str]] = [
    (r"^\.github/workflows/[^/]+\.ya?ml$",
     r"^\s*(?:-\s+)?uses:\s*[\"']?[\w.\-/]+@(?P<v>[\w.\-]+)[\"']?(?P<c>\s+#.*)?\s*$"),
]

# Words that cite a document by section number (a word, the section sign,
# a number) -> the document's path. Empty: no such document exists yet.
SECTION_ALIASES: Dict[str, str] = {}

INVARIANTS = "docs/invariants.md"
MAP_FILE = "docs/features/README.md"
MAP_HEADER = ["#", "source path regex", "doc path regex", "message"]
EXCLUDE_HEADER = ["path regex", "why"]

FOOTER = (
    "What to update: the \"You changed / You must also update\" table in AGENTS.md "
    "(section \"Documentation contract\").\n"
    "How to write it: docs/guides/documentation.md."
)

HASH_COMMENT = {"py", "sh", "bash", "zsh", "yml", "yaml", "toml", "cfg", "ini", "mk", "rb", "pl", "r",
                "conf", "makefile", "dockerfile", "gitignore", "gitattributes", "editorconfig"}
SLASH_COMMENT = {"js", "jsx", "ts", "tsx", "mjs", "cjs", "go", "rs", "c", "h", "cc", "cpp", "hpp", "java",
                 "kt", "kts", "swift", "cs", "scala", "dart", "php", "css", "scss", "less"}
DASH_COMMENT = {"sql", "lua", "hs"}
HTML_COMMENT = {"html", "htm", "xml", "svg", "vue"}

LINK_RE = re.compile(
    r"!?\[(?:[^\[\]]|\[[^\[\]]*\])*\]\(\s*(<[^>]*>|[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*\)")
REFDEF_RE = re.compile(r"^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)")
CODE_SPAN_RE = re.compile(r"(`+)(.+?)\1")
DOCS_REF_RE = re.compile(r"(?<![\w/.-])(?:\./)?(docs/[\w./-]+?\.md)(?:#([\w-]+))?(?!\w)")
DOCS_SPAN_RE = re.compile(r"^(?:\./)?(docs/[a-z0-9_./-]+\.md)(?:#([a-z0-9_-]+))?$")
MESSAGE_DOC_RE = re.compile(r"docs/[a-z0-9_./-]+\.md")
LINE_REF_RE = re.compile(r"[\w./-]+\.md(?::\d+|#L\d+)(?!\w)")
SECTION_RE = re.compile(r"(?:(?P<doc>[\w./-]+\.md)|(?P<alias>\b[A-Za-z][\w-]*))\s*§\s*(?P<sec>\d+(?:\.\d+)*)")
EXTERNAL_RE = re.compile(r"^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|//)")
INVARIANT_RE = re.compile(r"^- \*\*(\d+)\.\*\* \S")
TEST_ID_RE = re.compile(r"^\s+- `([^`:]+)((?:::[A-Za-z_]\w*)+)`\s*$")
LIST_ITEM_RE = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])(?:\s|$)")


class GitError(Exception):
    pass


# --------------------------------------------------------------------------
# git
# --------------------------------------------------------------------------

def git(root: str, *args: str, ok: Tuple[int, ...] = (0,)) -> subprocess.CompletedProcess:
    proc = subprocess.run(["git", "-C", root, *args], capture_output=True)
    if proc.returncode not in ok:
        raise GitError(f"git {' '.join(args)} failed: {proc.stderr.decode(errors='replace').strip()}")
    return proc


def zlist(proc: subprocess.CompletedProcess) -> List[str]:
    return [p for p in proc.stdout.decode("utf-8", errors="surrogateescape").split("\0") if p]


def resolve(root: str, ref: str) -> Optional[str]:
    proc = git(root, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}", ok=(0, 1, 128))
    return proc.stdout.decode().strip() if proc.returncode == 0 else None


def find_base(root: str, base: Optional[str]) -> Tuple[str, str]:
    """(ref name, merge-base sha). Raises GitError with a message for exit 2."""
    candidates = [base] if base else ["origin/main", "main"]
    for ref in candidates:
        if resolve(root, ref):
            proc = git(root, "merge-base", "HEAD", ref, ok=(0, 1))
            if proc.returncode != 0:
                raise GitError(f"HEAD and {ref} have no merge base")
            return ref, proc.stdout.decode().strip()
    if base:
        raise GitError(f"base ref '{base}' does not exist")
    raise GitError("no base branch: neither origin/main nor main exists; pass --base REF")


def changed_files(root: str, mb: str) -> List[str]:
    paths: Set[str] = set()
    paths.update(zlist(git(root, "diff", "--name-only", "-z", "--no-renames", mb, "HEAD")))
    paths.update(zlist(git(root, "diff", "--name-only", "-z", "--no-renames", "HEAD")))
    paths.update(zlist(git(root, "diff", "--name-only", "-z", "--no-renames", "--cached")))
    paths.update(zlist(git(root, "ls-files", "-z", "--others", "--exclude-standard")))
    return sorted(paths)


def new_files(root: str, mb: str) -> Set[str]:
    """Files added since the merge base (a git mv is a rename, not an addition), plus untracked files."""
    paths = set(zlist(git(root, "diff", "--name-only", "-z", "--find-renames", "--diff-filter=A", mb)))
    paths.update(zlist(git(root, "ls-files", "-z", "--others", "--exclude-standard")))
    return paths


def tree_files(root: str) -> List[str]:
    """Tracked and untracked, not ignored, regular files (symlinks are skipped)."""
    out = []
    for p in sorted(set(zlist(git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")))):
        full = os.path.join(root, p)
        if os.path.islink(full) or not os.path.isfile(full):
            continue
        out.append(p)
    return out


# --------------------------------------------------------------------------
# Filters
# --------------------------------------------------------------------------

def excluded(path: str) -> Optional[str]:
    for rx, why in EXCLUDE:
        if re.search(rx, path):
            return why
    return None


def _without_version(m: re.Match) -> str:
    line = m.string
    spans = sorted(m.span(g) for g in ("v", "c") if g in m.re.groupindex and m.group(g) is not None)
    out, pos = [], 0
    for start, end in spans:
        out.append(line[pos:start])
        pos = end
    out.append(line[pos:])
    return "".join(out)


def is_version_bump(root: str, mb: str, path: str) -> bool:
    """True if every changed line of `path` (merge base -> working tree) is a
    version line and the lines differ only in their versions."""
    line_rx = next((re.compile(lx) for px, lx in BUMP_FILTERS if re.search(px, path)), None)
    if line_rx is None:
        return False
    diff = git(root, "diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", mb, "--", path).stdout
    hunks: List[Tuple[List[str], List[str]]] = []
    for raw in diff.decode("utf-8").splitlines():
        if raw.startswith("@@"):
            hunks.append(([], []))
        elif hunks and raw[:1] == "-":
            hunks[-1][0].append(raw[1:])
        elif hunks and raw[:1] == "+":
            hunks[-1][1].append(raw[1:])
    if not hunks:
        return False
    for removed, added in hunks:
        # Each hunk replaces lines one for one, in place: a line moved to
        # another place shows up as a hunk without its counterpart.
        if len(removed) != len(added):
            return False
        for old, new in zip(removed, added):
            mo, mn = line_rx.fullmatch(old), line_rx.fullmatch(new)
            if not mo or not mn or old == new or _without_version(mo) != _without_version(mn):
                return False
    return True


# --------------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------------

def evaluate(sources: List[str], changed: List[str], new: Set[str],
             deleted: Set[str] = frozenset()) -> List[Tuple[Rule, List[str]]]:
    """Broken rules with the source paths that triggered them. The catch-all
    skips deleted paths: removing code no rule owns needs no new document."""
    broken = []
    regular = [r for r in RULES if not r.catch_all]
    for rule in RULES:
        if rule.catch_all:
            hits = [p for p in sources if p not in deleted and re.search(rule.source, p)
                    and not any(re.search(r.source, p) for r in regular)]
            documented = any(re.search(rule.docs, d) for d in new)
        else:
            hits = [p for p in sources if re.search(rule.source, p)]
            documented = any(re.search(rule.docs, d) for d in changed)
        if hits and not documented:
            broken.append((rule, hits))
    return broken


# --------------------------------------------------------------------------
# Integrity checks
# --------------------------------------------------------------------------

_index_module = None


def index_module():
    """scripts/decisions-index.py, loaded once (its name is not importable)."""
    global _index_module
    if _index_module is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "decisions-index.py")
        spec = importlib.util.spec_from_file_location("decisions_index", path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules.setdefault(spec.name, mod)  # dataclasses look their module up here
        spec.loader.exec_module(mod)
        _index_module = mod
    return _index_module


class Tree:
    """Read-only view of the files in the working tree, with caches."""

    def __init__(self, root: str):
        self.root = root
        self.files = tree_files(root)
        self._text: Dict[str, Optional[str]] = {}
        self._anchors: Dict[str, set] = {}
        self._listing: Dict[str, Set[str]] = {}

    def text(self, rel: str) -> Optional[str]:
        if rel not in self._text:
            try:
                with open(os.path.join(self.root, rel), encoding="utf-8") as f:
                    self._text[rel] = f.read()
            except (OSError, UnicodeDecodeError):
                self._text[rel] = None
        return self._text[rel]

    def exists(self, rel: str) -> bool:
        """Exact-case existence, so a link that only works on a case-insensitive disk fails."""
        cur = ""
        for part in rel.split("/"):
            if part in ("", "."):
                continue
            if cur not in self._listing:
                try:
                    self._listing[cur] = set(os.listdir(os.path.join(self.root, cur)))
                except OSError:
                    self._listing[cur] = set()
            if part not in self._listing[cur]:
                return False
            cur = posixpath.join(cur, part)
        return True

    def anchors(self, rel: str) -> set:
        if rel not in self._anchors:
            self._anchors[rel] = index_module().anchors(self.text(rel) or "")
        return self._anchors[rel]

    def headings(self, rel: str):
        return index_module().headings(self.text(rel) or "")


def strip_code_spans(line: str) -> str:
    return CODE_SPAN_RE.sub(lambda m: " " * len(m.group(0)), line)


def markdown_lines(text: str) -> Iterable[Tuple[int, str, List[str]]]:
    """(line number, line without code spans, code span contents) outside fenced code."""
    for n, line, kind in index_module().scan(text):
        if kind == "text":
            yield n, strip_code_spans(line), [m.group(2).strip() for m in CODE_SPAN_RE.finditer(line)]


def comment_markers(path: str) -> Optional[Tuple[str, ...]]:
    base = posixpath.basename(path).lower()
    ext = base.rsplit(".", 1)[-1] if "." in base else base
    if ext in HASH_COMMENT or base in HASH_COMMENT:
        return ("#",)
    if ext in SLASH_COMMENT:
        return ("//", "/*")
    if ext in DASH_COMMENT:
        return ("--",)
    if ext in HTML_COMMENT:
        return ("<!--",)
    return None


def comment_lines(path: str, text: str) -> Iterable[Tuple[int, str]]:
    """(line number, comment text) for each line of a code file that holds a comment."""
    markers = comment_markers(path)
    if not markers:
        return
    for n, line in enumerate(text.splitlines(), 1):
        if "/*" in markers and line.lstrip().startswith("*"):
            yield n, line
            continue
        positions = [line.find(m) for m in markers if m in line]
        if positions:
            yield n, line[min(positions):]


def check_target(tree: Tree, src: str, n: int, rel: str, frag: Optional[str], what: str) -> Optional[str]:
    rel = posixpath.normpath(rel) if rel else rel
    if rel.startswith("../") or rel == "..":
        return f"{src}:{n}: {what} points outside the repository"
    if rel and not tree.exists(rel):
        return f"{src}:{n}: {what} points to a missing file: {rel}"
    if frag and re.fullmatch(r"L\d+(?:-L\d+)?", frag):
        return f"{src}:{n}: {what} uses a line number (#{frag}); link the heading anchor or name the symbol"
    target = rel or src
    if frag and target.endswith(".md") and frag not in tree.anchors(target):
        return f"{src}:{n}: {what} points to a missing heading: {target}#{frag}"
    return None


def check_links(tree: Tree) -> List[str]:
    problems = []
    for src in tree.files:
        if not src.endswith(".md"):
            continue
        text = tree.text(src)
        if text is None:
            continue
        here = posixpath.dirname(src)
        for n, line, spans in markdown_lines(text):
            targets = [m.group(1) for m in LINK_RE.finditer(line)]
            m = REFDEF_RE.match(line)
            if m:
                targets.append(m.group(1))
            for raw in targets:
                target = raw[1:-1] if raw.startswith("<") and raw.endswith(">") else raw
                if EXTERNAL_RE.match(target):
                    continue
                path, _, frag = target.partition("#")
                path = unquote(path)
                frag = unquote(frag) or None
                if path.startswith("/"):
                    rel = path.lstrip("/")
                elif path:
                    rel = posixpath.join(here, path)
                else:
                    rel = ""
                p = check_target(tree, src, n, rel, frag, f"link '{target}'")
                if p:
                    problems.append(p)
            for span in spans:
                m = DOCS_SPAN_RE.match(span)
                if m:
                    p = check_target(tree, src, n, m.group(1), m.group(2), f"`{span}`")
                    if p:
                        problems.append(p)
            for m in LINE_REF_RE.finditer(line):
                problems.append(f"{src}:{n}: '{m.group(0)}' refers to a line number; use the heading anchor")
    return problems


def check_code_refs(tree: Tree) -> List[str]:
    problems = []
    for src in tree.files:
        if src.endswith(".md"):
            continue
        text = tree.text(src)
        if text is None:
            continue
        for n, comment in comment_lines(src, text):
            for m in DOCS_REF_RE.finditer(comment):
                p = check_target(tree, src, n, m.group(1), m.group(2), f"reference '{m.group(0)}'")
                if p:
                    problems.append(p)
            for m in LINE_REF_RE.finditer(comment):
                problems.append(f"{src}:{n}: '{m.group(0)}' refers to a line number; use the heading anchor")
    return problems


def check_section_citations(tree: Tree) -> List[str]:
    problems = []
    for src in tree.files:
        text = tree.text(src)
        if text is None:
            continue
        if src.endswith(".md"):
            lines = [(n, line) for n, line, _ in markdown_lines(text)]
            here = posixpath.dirname(src)
        else:
            lines = list(comment_lines(src, text))
            here = ""
        for n, line in lines:
            for m in SECTION_RE.finditer(line):
                cite, sec = m.group(0), m.group("sec")
                if m.group("doc"):
                    doc = posixpath.normpath(posixpath.join(here, m.group("doc")))
                    if not tree.exists(doc):
                        doc = posixpath.normpath(m.group("doc"))
                elif m.group("alias") in SECTION_ALIASES:
                    doc = SECTION_ALIASES[m.group("alias")]
                else:
                    problems.append(f"{src}:{n}: '{cite}' cites an unknown document; cite the file path "
                                    f"or add '{m.group('alias')}' to SECTION_ALIASES in scripts/check-docs.py")
                    continue
                if not tree.exists(doc):
                    problems.append(f"{src}:{n}: '{cite}' cites a missing file: {doc}")
                    continue
                rx = re.compile(r"^§?\s*" + re.escape(sec) + r"(?:[.):\s]|$)")
                if not any(rx.match(h.text) for h in tree.headings(doc)):
                    problems.append(f"{src}:{n}: '{cite}': {doc} has no heading for section {sec}")
    return problems


def split_row(line: str) -> List[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", s)]


def table_after_header(text: str, header: List[str]) -> Optional[List[Tuple[int, List[str]]]]:
    rows: Optional[List[Tuple[int, List[str]]]] = None
    for n, line, kind in index_module().scan(text):
        if rows is None:
            if kind == "text" and line.lstrip().startswith("|") and [c.lower() for c in split_row(line)] == header:
                rows = []
            continue
        if kind != "text" or not line.lstrip().startswith("|"):
            break
        cells = split_row(line)
        if all(re.fullmatch(r":?-+:?", c) for c in cells):
            continue
        rows.append((n, cells))
    return rows


def code_cell(cell: str) -> Optional[str]:
    m = re.fullmatch(r"(`+) ?(.*?) ?\1", cell)
    return m.group(2) if m else None


def check_map(tree: Tree) -> List[str]:
    problems = []
    text = tree.text(MAP_FILE)
    if text is None:
        return [f"{MAP_FILE} is missing; it must hold the ownership map"]
    rows = table_after_header(text, MAP_HEADER)
    if rows is None:
        problems.append(f"{MAP_FILE}: no ownership-map table with columns: {' | '.join(MAP_HEADER)}")
        rows = []
    table: Dict[str, Tuple[int, str, str, str]] = {}
    for n, cells in rows:
        if len(cells) != 4:
            problems.append(f"{MAP_FILE}:{n}: ownership-map row needs 4 cells, has {len(cells)}")
            continue
        rid, src, doc, msg = cells
        src_c, doc_c = code_cell(src), code_cell(doc)
        if src_c is None or doc_c is None:
            problems.append(f"{MAP_FILE}:{n}: rule {rid}: write both regexes as code spans")
            continue
        if rid in table:
            problems.append(f"{MAP_FILE}:{n}: rule {rid} appears twice")
        table[rid] = (n, src_c, doc_c, msg)
    for rule in RULES:
        if rule.id not in table:
            problems.append(f"{MAP_FILE}: rule {rule.id} from RULES is missing from the ownership-map table")
            continue
        n, src, doc, msg = table[rule.id]
        for field, mine, theirs in (("source regex", rule.source, src), ("doc regex", rule.docs, doc),
                                    ("message", rule.message, msg)):
            if mine != theirs:
                problems.append(f"{MAP_FILE}:{n}: rule {rule.id}: {field} differs from RULES "
                                f"(RULES: {mine!r}, table: {theirs!r})")
    ids = {r.id for r in RULES}
    for rid, (n, *_rest) in table.items():
        if rid not in ids:
            problems.append(f"{MAP_FILE}:{n}: rule {rid} is not in RULES in scripts/check-docs.py")

    rows = table_after_header(text, EXCLUDE_HEADER)
    if rows is None:
        problems.append(f"{MAP_FILE}: no exclusions table with columns: {' | '.join(EXCLUDE_HEADER)}")
        rows = []
    listed: Dict[str, Tuple[int, str]] = {}
    for n, cells in rows:
        rx = code_cell(cells[0]) if len(cells) == 2 else None
        if rx is None:
            problems.append(f"{MAP_FILE}:{n}: exclusion row needs 2 cells, the regex as a code span")
            continue
        if rx in listed:
            problems.append(f"{MAP_FILE}:{n}: exclusion {rx!r} appears twice")
        listed[rx] = (n, cells[1])
    for rx, why in EXCLUDE:
        if rx not in listed:
            problems.append(f"{MAP_FILE}: exclusion {rx!r} from EXCLUDE is missing from the exclusions table")
        elif listed[rx][1] != why:
            problems.append(f"{MAP_FILE}:{listed[rx][0]}: exclusion {rx!r}: reason differs from EXCLUDE "
                            f"(EXCLUDE: {why!r}, table: {listed[rx][1]!r})")
    for rx, (n, _) in listed.items():
        if rx not in dict(EXCLUDE):
            problems.append(f"{MAP_FILE}:{n}: exclusion {rx!r} is not in EXCLUDE in scripts/check-docs.py")

    for rule in RULES:
        for doc in MESSAGE_DOC_RE.findall(rule.message):
            if not tree.exists(doc):
                problems.append(f"scripts/check-docs.py: rule {rule.id}: its message names a missing file: {doc}")
    return problems


def check_invariants(tree: Tree) -> List[str]:
    text = tree.text(INVARIANTS)
    if text is None:
        return [f"{INVARIANTS} is missing"]
    problems = []
    seen: Dict[str, int] = {}
    current: Optional[Tuple[int, str, bool, List[str]]] = None
    items: List[Tuple[int, str, bool, List[str]]] = []
    for n, line, kind in index_module().scan(text):
        if kind != "text":
            continue
        m = LIST_ITEM_RE.match(line)
        if not m:
            continue
        if m.group(1) == "":
            im = INVARIANT_RE.match(line)
            if not im:
                problems.append(f"{INVARIANTS}:{n}: list item is not of the form '- **<N>.** <rule>': {line.strip()}")
                current = None
                continue
            num = im.group(1)
            if num in seen:
                problems.append(f"{INVARIANTS}:{n}: invariant {num} is already used on line {seen[num]}")
            seen.setdefault(num, n)
            struck = line[im.end() - 1:].startswith("~~")
            current = (n, num, struck, [])
            items.append(current)
        else:
            tm = TEST_ID_RE.match(line)
            if not tm or current is None:
                problems.append(f"{INVARIANTS}:{n}: nested item is not a test id under an invariant "
                                f"('  - `path::test_name`'): {line.strip()}")
                continue
            current[3].append(tm.group(1) + tm.group(2))
    for n, num, struck, ids in items:
        if struck:
            continue
        if not ids:
            problems.append(f"{INVARIANTS}:{n}: invariant {num} names no test; a rule no test enforces "
                            "belongs in the technical document as a note")
        for tid in ids:
            path, *names = tid.split("::")
            body = tree.text(path) if tree.exists(path) else None
            if body is None:
                problems.append(f"{INVARIANTS}:{n}: invariant {num}: test file {path} does not exist")
                continue
            missing = missing_test(path, body, names)
            if missing:
                problems.append(f"{INVARIANTS}:{n}: invariant {num}: {tid}: {missing}")
    return problems


@functools.lru_cache(maxsize=None)
def _parse_python(body: str) -> ast.Module:
    """Parsed once per file content: docs/invariants.md names one test file many times."""
    return ast.parse(body)


def missing_test(path: str, body: str, names: List[str]) -> Optional[str]:
    """None if `path::names` is a test that exists, else what is missing. Python
    files are parsed, so a method named under the wrong class is missing."""
    if not path.endswith(".py"):
        for i, name in enumerate(names):
            kw = "def" if i == len(names) - 1 else "class"
            if not re.search(rf"^\s*(?:async\s+)?{kw}\s+{re.escape(name)}\b", body, re.M):
                return f"no {kw} {name} in {path}"
        return None
    try:
        nodes = _parse_python(body).body
    except SyntaxError as e:
        return f"{path} does not parse ({e.msg}, line {e.lineno})"
    scope = path
    for i, name in enumerate(names):
        last = i == len(names) - 1
        kinds = (ast.FunctionDef, ast.AsyncFunctionDef) if last else (ast.ClassDef,)
        found = next((x for x in nodes if isinstance(x, kinds) and x.name == name), None)
        if found is None:
            return f"no {'def' if last else 'class'} {name} in {scope}"
        nodes, scope = getattr(found, "body", []), f"{path}::{'::'.join(names[:i + 1])}"
    return None


def integrity(root: str) -> List[str]:
    tree = Tree(root)
    problems: List[str] = []
    problems += check_links(tree)
    problems += check_code_refs(tree)
    problems += check_section_citations(tree)
    problems += [f"{p} (scripts/decisions-index.py --check)" for p in index_module().check(root)]
    problems += check_map(tree)
    problems += check_invariants(tree)
    return problems


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def integrity_only(root: str) -> int:
    problems = integrity(root)
    if problems:
        print("docs-check: integrity checks failed:")
        for p in problems:
            print(f"✗ {p} [integrity]")
        print()
        print(FOOTER)
        return 1
    print(f"docs-check: integrity checks pass on {plural(len(tree_files(root)), 'file')}")
    return 0


def main(argv: Optional[Sequence[str]] = None, root: Optional[str] = None) -> int:
    parser = argparse.ArgumentParser(description="Check that every behaviour change carries its documentation.")
    parser.add_argument("--base", metavar="REF", help="base branch (default: origin/main, else main)")
    parser.add_argument("-v", "--verbose", action="store_true", help="list the changed files")
    parser.add_argument("--integrity-only", action="store_true",
                        help="run only the whole-tree integrity checks (no base needed)")
    args = parser.parse_args(argv)

    if os.environ.get("SKIP_DOCS_CHECK") == "1":
        if os.environ.get("CI"):
            print("docs-check: SKIP_DOCS_CHECK is ignored because CI is set")
        else:
            print("docs-check: skipped because SKIP_DOCS_CHECK=1 (local only; CI always runs the check)")
            return 0

    try:
        if root is None:
            root = git(os.getcwd(), "rev-parse", "--show-toplevel").stdout.decode().strip()
        if args.integrity_only:
            return integrity_only(root)
        ref, mb = find_base(root, args.base)
        short = git(root, "rev-parse", "--short", mb).stdout.decode().strip()
        changed = changed_files(root, mb)
        new = new_files(root, mb)
    except GitError as e:
        print(f"docs-check: {e}")
        return 2

    failures: List[str] = []
    sources: List[str] = []
    notes: Dict[str, str] = {}
    for path in changed:
        why = excluded(path)
        if why:
            notes[path] = f"left out: {why}"
            continue
        try:
            bump = is_version_bump(root, mb, path)
        except Exception as e:  # a broken filter must fail the check, never pass it
            failures.append(f"✗ version-bump filter failed on {path} ({type(e).__name__}: {e}); "
                            "the check fails instead of guessing [filter]")
            bump = False
        if bump:
            notes[path] = "left out: version bump only"
            continue
        sources.append(path)

    if args.verbose:
        print(f"docs-check: changed since {ref} ({short}):")
        for path in changed:
            print(f"  {path}" + (f"  ({notes[path]})" if path in notes else ""))

    deleted = {p for p in changed if not os.path.lexists(os.path.join(root, p))}
    for rule, hits in evaluate(sources, changed, new, deleted):
        failures.append(f"✗ {rule.message} [{rule.id}]")
        failures.extend(f"    {p}" for p in hits)
    failures.extend(f"✗ {p} [integrity]" for p in integrity(root))

    if failures:
        print(f"docs-check: failed against {ref} ({short}):")
        for f in failures:
            print(f)
        print()
        print(FOOTER)
        return 1
    print(f"docs-check: {plural(len(changed), 'changed file')} since {ref} ({short}), "
          "each with the documentation it needs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
