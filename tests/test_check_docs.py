"""Tests for scripts/check-docs.py.

Each test copies this repository's working tree into a temporary git
repository (branch `main` with one commit, then a branch `feature`), changes
it, and runs the copied script there. Requires git 2.32 or later
(GIT_CONFIG_GLOBAL) and no network. See docs/guides/testing.md.
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
SECT = "§"  # the section sign, spelled out so this file cites no section itself

GIT_ENV = {
    "GIT_AUTHOR_NAME": "Test",
    "GIT_AUTHOR_EMAIL": "test@example.invalid",
    "GIT_COMMITTER_NAME": "Test",
    "GIT_COMMITTER_EMAIL": "test@example.invalid",
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
}


def base_env(**extra: str) -> dict:
    env = {k: v for k, v in os.environ.items() if k not in ("CI", "SKIP_DOCS_CHECK") and not k.startswith("GIT_")}
    env.update(GIT_ENV)
    env.update(extra)
    return env


def load_check_docs():
    spec = importlib.util.spec_from_file_location("check_docs", REPO / "scripts" / "check-docs.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod  # dataclasses look their module up here
    spec.loader.exec_module(mod)
    return mod


TEMPLATE: Path


def setUpModule():
    global TEMPLATE, _tmp
    _tmp = tempfile.TemporaryDirectory()
    TEMPLATE = Path(_tmp.name) / "template"
    TEMPLATE.mkdir()
    listed = subprocess.run(["git", "-C", str(REPO), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                            capture_output=True, check=True).stdout.decode().split("\0")
    for rel in sorted({p for p in listed if p}):
        src, dst = REPO / rel, TEMPLATE / rel
        if not (src.exists() or src.is_symlink()):
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_symlink():
            os.symlink(os.readlink(src), dst)
        else:
            shutil.copy2(src, dst)
    for args in (["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "base"],
                 ["switch", "-q", "-c", "feature"]):
        subprocess.run(["git", *args], cwd=TEMPLATE, env=base_env(), check=True, capture_output=True)


def tearDownModule():
    _tmp.cleanup()


class RepoCase(unittest.TestCase):
    """A fresh copy of the template repository, on branch `feature`."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name) / "repo"
        shutil.copytree(TEMPLATE, self.root, symlinks=True)

    def git(self, *args: str) -> str:
        proc = subprocess.run(["git", *args], cwd=self.root, env=base_env(), capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return proc.stdout

    def write(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def append(self, rel: str, text: str) -> None:
        with open(self.root / rel, "a", encoding="utf-8") as f:
            f.write(text)

    def replace(self, rel: str, old: str, new: str) -> None:
        text = (self.root / rel).read_text(encoding="utf-8")
        self.assertIn(old, text, f"fixture text not found in {rel}")
        (self.root / rel).write_text(text.replace(old, new), encoding="utf-8")

    def commit(self, *paths: str, msg: str = "change") -> None:
        self.git("add", "-A", "--", *paths) if paths else self.git("add", "-A")
        self.git("commit", "-q", "-m", msg)

    def check(self, *args: str, **env: str):
        proc = subprocess.run([sys.executable, "scripts/check-docs.py", *args], cwd=self.root,
                              env=base_env(**env), capture_output=True, text=True)
        return proc.returncode, proc.stdout + proc.stderr

    def assertPasses(self, *args: str, **env: str) -> str:
        code, out = self.check(*args, **env)
        self.assertEqual(code, 0, out)
        return out

    def assertFails(self, rule_id: str, *args: str, **env: str) -> str:
        code, out = self.check(*args, **env)
        self.assertEqual(code, 1, out)
        self.assertIn(f"[{rule_id}]", out)
        return out

    def touch_makefile(self) -> None:
        self.append("Makefile", "\n# touched\n")

    def touch_dev_guide(self) -> None:
        self.append("docs/guides/development.md", "\nTouched.\n")


class RuleTests(RepoCase):
    def test_no_changes_pass(self):
        self.assertPasses()

    def test_owned_path_without_doc_fails(self):
        self.touch_makefile()
        self.commit()
        out = self.assertFails("C1")
        self.assertIn("✗ Build targets changed: update docs/guides/development.md", out)
        self.assertIn("    Makefile", out)
        self.assertIn("AGENTS.md", out)
        self.assertIn("docs/guides/documentation.md", out)

    def test_owned_path_with_doc_passes(self):
        self.touch_makefile()
        self.touch_dev_guide()
        self.commit()
        self.assertPasses()

    def test_tests_only_change_passes(self):
        self.append("tests/test_check_docs.py", "\n# touched\n")
        self.write("tests/data/fixture.txt", "data\n")
        self.commit()
        self.assertPasses()

    def test_untracked_source_counts(self):
        self.write(".github/workflows/extra.yml", "name: extra\n")
        self.assertFails("C2")

    def test_untracked_doc_counts(self):
        self.write("src/app.py", "print('hi')\n")
        self.commit()
        self.write("docs/features/app-technical.md", "# App\n\nWhat it does.\n")
        self.assertPasses()

    def test_staged_doc_counts(self):
        self.touch_makefile()
        self.commit()
        self.touch_dev_guide()
        self.git("add", "docs/guides/development.md")
        self.assertPasses()

    def test_unstaged_doc_counts(self):
        self.touch_makefile()
        self.commit()
        self.touch_dev_guide()
        self.assertPasses()

    def test_staged_source_counts(self):
        self.touch_makefile()
        self.git("add", "Makefile")
        self.assertFails("C1")

    def test_unstaged_source_counts(self):
        self.touch_makefile()
        self.assertFails("C1")

    SAMPLES = ["tests/data/x.json", "src/app.test.js", "web/package-lock.json", "LICENSE", ".gitignore",
               "docs/notes.md", "README.md", "AGENTS.md", "CONTRIBUTING.md", ".github/pull_request_template.md",
               ".claude/settings.json", "packages/core/test/helpers.ts", "tools/capture-cli/e2e/cli.ts",
               "fixtures/p2pro/frame.yuv", "NOTICE"]

    def test_every_exclusion_needs_no_doc(self):
        mod = load_check_docs()
        for rx, _ in mod.EXCLUDE:
            self.assertTrue(any(re.search(rx, p) for p in self.SAMPLES), f"no sample for {rx}")
        for p in self.SAMPLES:
            if (self.root / p).exists():
                self.append(p, "\n")
            else:
                self.write(p, "# sample\n" if p.endswith(".md") else "x\n")
        self.commit()
        self.assertPasses()

    def test_deletion_needs_doc(self):
        self.git("rm", "-q", "Makefile")
        self.commit()
        self.assertFails("C1")

    def test_package_source_is_not_excluded(self):
        self.write("packages/core/src/test/frames.ts", "export const frames = [];\n")
        self.write("packages/core/testing.ts", "export {};\n")
        out = self.assertFails("F2")
        self.assertIn("    packages/core/src/test/frames.ts", out)
        self.assertIn("    packages/core/testing.ts", out)

    def test_rename_needs_doc(self):
        self.git("mv", ".github/workflows/ci.yml", ".github/workflows/pr.yml")
        self.commit()
        out = self.assertFails("C2")
        self.assertIn(".github/workflows/ci.yml", out)


class BaseTests(RepoCase):
    def test_no_merge_base_exits_2(self):
        self.git("switch", "-q", "--orphan", "unrelated")
        self.git("checkout", "feature", "--", ".")
        self.commit(msg="unrelated")
        code, out = self.check()
        self.assertEqual(code, 2, out)
        self.assertIn("docs-check: HEAD and main have no merge base", out)

    def test_no_base_exits_2(self):
        self.git("branch", "-m", "main", "trunk")
        code, out = self.check()
        self.assertEqual(code, 2, out)
        self.assertIn("no base branch: neither origin/main nor main exists; pass --base REF", out)

    def test_missing_base_ref_exits_2(self):
        code, out = self.check("--base", "nope")
        self.assertEqual(code, 2, out)
        self.assertIn("base ref 'nope' does not exist", out)

    def test_base_option(self):
        self.git("branch", "-m", "main", "trunk")
        self.touch_makefile()
        self.commit()
        out = self.assertFails("C1", "--base", "trunk")
        self.assertIn("against trunk", out)

    def test_origin_main_before_main(self):
        base = self.git("rev-parse", "main").strip()
        self.touch_makefile()
        self.commit()
        self.git("branch", "-f", "main", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", base)
        out = self.assertFails("C1")
        self.assertIn("against origin/main", out)
        self.assertPasses("--base", "main")


class BumpFilterTests(RepoCase):
    WORKFLOW = ".github/workflows/ci.yml"

    def test_bump_only_passes(self):
        self.replace(self.WORKFLOW, "actions/checkout@v7", "actions/checkout@v6.0.2")
        self.commit()
        out = self.assertPasses("-v")
        self.assertIn(f"{self.WORKFLOW}  (left out: version bump only)", out)

    def test_bump_with_other_change_fails(self):
        self.replace(self.WORKFLOW, "actions/checkout@v7", "actions/checkout@v6")
        self.replace(self.WORKFLOW, "timeout-minutes: 5", "timeout-minutes: 6")
        self.commit()
        self.assertFails("C2")

    def test_changed_action_name_is_not_a_bump(self):
        self.replace(self.WORKFLOW, "actions/checkout@v7", "someone/checkout@v7")
        self.commit()
        self.assertFails("C2")

    def test_moved_uses_line_is_not_a_bump(self):
        self.replace(self.WORKFLOW, "      - uses: actions/checkout@v7\n      - name: Unit tests",
                     "      - name: Unit tests")
        self.replace(self.WORKFLOW, "      - name: Documentation integrity",
                     "      - uses: actions/checkout@v7\n      - name: Documentation integrity")
        self.commit()
        self.assertFails("C2")

    def test_crashing_filter_fails(self):
        mod = load_check_docs()
        self.touch_makefile()
        self.touch_dev_guide()
        self.commit()

        def boom(*_args):
            raise RuntimeError("filter bug")

        out = io.StringIO()
        with mock.patch.object(mod, "is_version_bump", boom), \
                mock.patch.dict(os.environ, base_env(), clear=True), contextlib.redirect_stdout(out):
            code = mod.main([], root=str(self.root))
        self.assertEqual(code, 1, out.getvalue())
        self.assertIn("version-bump filter failed on Makefile (RuntimeError: filter bug)", out.getvalue())
        self.assertIn("[filter]", out.getvalue())


class PackageJsonBumpTests(RepoCase):
    """The JSON bump filter, on a package.json that exists on main."""

    MANIFEST = """{
  "name": "irvis",
  "private": true,
  "packageManager": "npm@11.0.0",
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
"""

    def setUp(self):
        super().setUp()
        self.git("switch", "-q", "main")
        self.write("package.json", self.MANIFEST)
        self.write("packages/core/package.json", self.MANIFEST.replace('"irvis"', '"@irvis/core"'))
        self.commit(msg="manifests")
        self.git("switch", "-q", "-C", "feature")

    def test_dependency_bump_passes(self):
        self.replace("package.json", '"react": "^19.0.0"', '"react": "^19.1.0"')
        self.replace("package.json", '"vitest": "^3.0.0"', '"vitest": "^3.2.4"')
        self.commit()
        out = self.assertPasses("-v")
        self.assertIn("package.json  (left out: version bump only)", out)

    def test_reformatted_bump_in_a_package_passes(self):
        path = "packages/core/package.json"
        text = (self.root / path).read_text(encoding="utf-8").replace('"^5.6.0"', '"^5.7.2"')
        self.write(path, json.dumps(json.loads(text), indent=4) + "\n")
        self.commit()
        self.assertPasses()

    def test_engines_change_fails(self):
        self.replace("package.json", '"node": ">=22"', '"node": ">=24"')
        self.commit()
        out = self.assertFails("C3")
        self.assertIn("    package.json", out)

    def test_package_manager_change_fails(self):
        self.replace("package.json", '"npm@11.0.0"', '"npm@11.1.0"')
        self.commit()
        self.assertFails("C3")

    def test_bump_with_engines_change_fails(self):
        self.replace("package.json", '"react": "^19.0.0"', '"react": "^19.1.0"')
        self.replace("package.json", '"node": ">=22"', '"node": ">=24"')
        self.commit()
        self.assertFails("C3")

    def test_added_dependency_fails(self):
        self.replace("package.json", '"react": "^19.0.0"', '"react": "^19.0.0",\n    "react-dom": "^19.0.0"')
        self.commit()
        self.assertFails("C3")

    def test_removed_dependency_fails(self):
        self.replace("package.json", '"react": "^19.0.0"', '"react": "^19.1.0"')
        self.replace("package.json", '"typescript": "^5.6.0",\n    "vitest": "^3.0.0"', '"typescript": "^5.6.0"')
        self.commit()
        self.assertFails("C3")

    def test_alias_change_fails(self):
        for source in ("npm:preact@^10.0.0", "github:someone/react", "file:../vendor/react",
                       "workspace:*", "someone/react"):
            with self.subTest(source=source):
                self.replace("package.json", '"react": "^19.0.0"', f'"react": "{source}"')
                self.assertFails("C3")
                self.replace("package.json", f'"react": "{source}"', '"react": "^19.0.0"')

    def test_dependency_moved_to_another_field_fails(self):
        self.replace("package.json", '"react": "^19.0.0"\n', '"react": "^19.0.0",\n    "vitest": "^3.0.0"\n')
        self.replace("package.json", '"typescript": "^5.6.0",\n    "vitest": "^3.0.0"', '"typescript": "^5.6.0"')
        self.commit()
        self.assertFails("C3")

    def test_other_value_type_is_not_a_bump(self):
        self.replace("package.json", '"private": true', '"private": 1')
        self.commit()
        self.assertFails("C3")

    def test_invalid_json_is_not_a_bump(self):
        self.replace("package.json", '"react": "^19.0.0"', '"react": "^19.1.0",')
        self.commit()
        out = self.assertFails("C3")
        self.assertNotIn("[filter]", out)


class TypeScriptRuleTests(RepoCase):
    """The rules that own the TypeScript code and its configuration."""

    def test_core_needs_core_doc(self):
        self.write("packages/core/src/frames.ts", "export {};\n")
        self.commit()
        out = self.assertFails("F2")
        self.assertNotIn("[F4]", out)
        self.append("docs/features/core-technical.md", "\nTouched.\n")
        self.assertPasses()

    def test_cameras_need_cameras_doc_not_core_doc(self):
        self.write("packages/core/src/cameras/index.ts", "export {};\n")
        self.append("docs/features/core-technical.md", "\nTouched.\n")
        self.commit()
        out = self.assertFails("F4")
        self.assertNotIn("[F2]", out)
        self.append("docs/features/cameras-user.md", "\nTouched.\n")
        self.assertPasses()

    def test_web_app_and_netlify_need_web_app_doc(self):
        for path in ("apps/web/src/App.tsx", "netlify.toml"):
            with self.subTest(path=path):
                self.write(path, "x\n")
                self.assertFails("F3")
                self.git("checkout", "-q", "--", path)
        self.write("netlify.toml", "x\n")
        self.append("docs/features/web-app-technical.md", "\nTouched.\n")
        self.assertPasses()

    def test_root_configuration_needs_a_guide(self):
        for path in ("tsconfig.base.json", "tsconfig.json", "eslint.config.js", "vitest.config.ts",
                     ".prettierrc.json", ".prettierignore", ".nvmrc", ".npmrc"):
            with self.subTest(path=path):
                self.write(path, "x\n")
                self.assertFails("C3")
                self.git("checkout", "-q", "--", path)
        self.write("tsconfig.base.json", "x\n")
        self.append("docs/guides/development.md", "\nTouched.\n")
        self.assertPasses()

    def test_package_test_helpers_need_no_doc(self):
        self.append("packages/core/test/profiles.ts", "\n// touched\n")
        self.append("packages/core/src/cameras/index.test.ts", "\n// touched\n")
        self.commit()
        self.assertPasses()


class CarveOutTests(RepoCase):
    def test_pr_template_needs_no_doc(self):
        self.append(".github/pull_request_template.md", "\n<!-- touched -->\n")
        self.commit()
        self.assertPasses()

    def test_new_file_in_github_dir_is_owned(self):
        self.write(".github/CODEOWNERS", "* @someone\n")
        self.commit()
        self.assertFails("C2")

    def test_check_script_needs_its_docs(self):
        self.append("scripts/check-docs.py", "\n# touched\n")
        self.touch_dev_guide()
        self.commit()
        self.assertFails("F1")

    def test_check_script_with_technical_doc_passes(self):
        self.append("scripts/decisions-index.py", "\n# touched\n")
        self.append("docs/features/docs-contract-technical.md", "\nTouched.\n")
        self.commit()
        self.assertPasses()

    def test_agent_tooling_needs_no_doc(self):
        self.write(".claude/rules/example.md", "# Example\n")
        self.append("AGENTS.md", "\nTouched.\n")
        self.commit()
        self.assertPasses()


class CatchAllTests(RepoCase):
    def test_unowned_path_needs_new_feature_doc(self):
        self.write("src/app.py", "print('hi')\n")
        self.append("docs/features/docs-contract-user.md", "\n")
        self.commit()
        out = self.assertFails("F0")
        self.assertIn("    src/app.py", out)

    def test_new_feature_doc_satisfies_catch_all(self):
        self.write("src/app.py", "print('hi')\n")
        self.write("docs/features/app-user.md", "# App\n\nWhat it does.\n")
        self.commit()
        self.assertPasses()

    def test_moved_doc_is_not_new(self):
        self.write("src/app.py", "print('hi')\n")
        self.git("mv", "docs/features/docs-contract-user.md", "docs/features/app-user.md")
        self.commit()
        self.assertFails("F0")

    def test_deleting_unowned_path_needs_no_new_doc(self):
        self.git("switch", "-q", "main")
        self.write("src/app.py", "print('hi')\n")
        self.write("docs/features/app-user.md", "# App\n\nWhat it does.\n")
        self.commit()
        self.git("switch", "-q", "-C", "feature")
        self.git("rm", "-q", "src/app.py", "docs/features/app-user.md")
        self.commit()
        self.assertPasses()

    def test_new_script_is_caught(self):
        self.write("scripts/release.sh", "echo release\n")
        self.touch_dev_guide()
        self.commit()
        self.assertFails("F0")


class SkipTests(RepoCase):
    def test_skip_works_locally(self):
        self.touch_makefile()
        out = self.assertPasses(SKIP_DOCS_CHECK="1")
        self.assertIn("skipped because SKIP_DOCS_CHECK=1", out)

    def test_skip_ignored_in_ci(self):
        self.touch_makefile()
        out = self.assertFails("C1", SKIP_DOCS_CHECK="1", CI="true")
        self.assertIn("docs-check: SKIP_DOCS_CHECK is ignored because CI is set", out)


class IntegrityTests(RepoCase):
    GUIDE = "docs/guides/testing.md"

    def assertIntegrityFails(self, needle: str) -> str:
        out = self.assertFails("integrity")
        self.assertIn(needle, out)
        return out

    def test_broken_link_fails(self):
        self.append(self.GUIDE, "\nSee [x](missing.md).\n")
        self.assertIntegrityFails("points to a missing file: docs/guides/missing.md")

    def test_broken_anchor_fails(self):
        self.append(self.GUIDE, "\nSee [x](development.md#no-such-heading).\n")
        self.assertIntegrityFails("points to a missing heading: docs/guides/development.md#no-such-heading")

    def test_link_outside_repository_fails(self):
        self.append(self.GUIDE, "\nSee [x](../../../outside.md).\n")
        self.assertIntegrityFails("points outside the repository")

    def test_wrong_case_fails(self):
        self.append(self.GUIDE, "\nSee [x](Development.md).\n")
        self.assertIntegrityFails("points to a missing file: docs/guides/Development.md")

    def test_code_is_ignored(self):
        self.append(self.GUIDE, "\n```md\n[x](missing.md)\n```\n\nInline: `[x](missing.md)`.\n")
        self.assertPasses()

    def test_valid_anchor_passes(self):
        self.append(self.GUIDE, "\nSee [x](../decisions/README.md#documentation-contract).\n")
        self.assertPasses()

    def test_docs_path_in_code_span_must_exist(self):
        self.append(self.GUIDE, "\nUpdate `docs/guides/nope.md`.\n")
        self.assertIntegrityFails("points to a missing file: docs/guides/nope.md")

    def test_comment_reference_must_exist(self):
        self.write("tests/helper.py", "# see " + "docs" + "/guides/testing.md#nope\n")
        self.assertIntegrityFails("points to a missing heading: docs/guides/testing.md#nope")

    def test_line_number_link_fails(self):
        self.append(self.GUIDE, "\nSee [d](../decisions/docs.md#L3).\n")
        self.assertIntegrityFails("uses a line number (#L3)")

    def test_line_number_text_fails(self):
        self.append(self.GUIDE, "\nSee docs/decisions/docs.md:12 for why.\n")
        self.assertIntegrityFails("'docs/decisions/docs.md:12' refers to a line number")

    def test_line_number_in_comment_fails(self):
        self.write("tests/helper.py", "# why: " + "docs" + "/decisions/docs.md" + ":12\n")
        self.assertIntegrityFails("refers to a line number")

    def test_section_citation_of_unknown_doc_fails(self):
        self.append(self.GUIDE, f"\nAs the plan {SECT}4.2 says.\n")
        self.assertIntegrityFails(f"'plan {SECT}4.2' cites an unknown document")

    def test_section_citation_needs_heading(self):
        self.write("docs/design.md", "# Design\n\n## 1. Scope\n\nText.\n")
        self.append(self.GUIDE, f"\nSee ../design.md {SECT}1 and ../design.md {SECT}2.\n")
        out = self.assertIntegrityFails(f"docs/design.md has no heading for section 2")
        self.assertNotIn("section 1", out)

    def test_section_alias_resolves(self):
        mod = load_check_docs()
        self.write("docs/design.md", "# Design\n\n## 4.2 Limits\n\nText.\n")
        self.write("tests/helper.py", f"# as design {SECT}4.2 says\n")
        with mock.patch.dict(mod.SECTION_ALIASES, {"design": "docs/design.md"}):
            self.assertEqual(mod.integrity(str(self.root)), [])

    def test_stale_decisions_index_fails(self):
        self.append("docs/decisions/docs.md", "\n## Something new was decided\n\nStatus: decided\n\nWhy.\n")
        self.assertIntegrityFails("docs/decisions/README.md is stale")
        subprocess.run([sys.executable, "scripts/decisions-index.py"], cwd=self.root, check=True,
                       capture_output=True)
        self.assertPasses()

    def test_unlisted_decision_file_fails(self):
        self.write("docs/decisions/other.md", "# Other\n")
        self.assertIntegrityFails("docs/decisions/other.md is not listed in DOMAINS")

    def test_map_row_differs_fails(self):
        self.replace("docs/features/README.md", "Build targets changed:", "Build changed:")
        self.assertIntegrityFails("rule C1: message differs from RULES")

    def test_map_row_missing_fails(self):
        text = (self.root / "docs/features/README.md").read_text(encoding="utf-8")
        text = re.sub(r"^\| C1 \|.*\n", "", text, flags=re.M)
        self.write("docs/features/README.md", text)
        self.assertIntegrityFails("rule C1 from RULES is missing from the ownership-map table")

    def test_map_row_extra_fails(self):
        self.replace("docs/features/README.md", "| C1 |", "| C9 | `^x$` | `^y$` | Extra |\n| C1 |")
        self.assertIntegrityFails("rule C9 is not in RULES")

    def test_map_row_twice_fails(self):
        text = (self.root / "docs/features/README.md").read_text(encoding="utf-8")
        row = re.search(r"^\| C1 \|.*\n", text, flags=re.M).group(0)
        self.write("docs/features/README.md", text.replace(row, row + row))
        self.assertIntegrityFails("rule C1 appears twice")

    def test_map_regex_not_code_span_fails(self):
        self.replace("docs/features/README.md", "| C1 | `^Makefile$` |", "| C1 | ^Makefile$ |")
        self.assertIntegrityFails("rule C1: write both regexes as code spans")

    def test_map_unescaped_pipe_fails(self):
        self.replace("docs/features/README.md", "`^Makefile$`", "`^Make|file$`")
        self.assertIntegrityFails("ownership-map row needs 4 cells, has 5")

    def test_exclusion_twice_fails(self):
        self.replace("docs/features/README.md", "| `^\\.gitignore$` | Git ignore list |\n",
                     "| `^\\.gitignore$` | Git ignore list |\n| `^\\.gitignore$` | Git ignore list |\n")
        self.assertIntegrityFails("appears twice")

    def test_exclusion_differs_fails(self):
        self.replace("docs/features/README.md", "| Licence |", "| Licence file |")
        self.assertIntegrityFails("reason differs from EXCLUDE")

    def test_duplicate_invariant_fails(self):
        self.append("docs/invariants.md", "\n- **1.** A second rule one.\n  - `tests/test_check_docs.py::RuleTests::test_no_changes_pass`\n")
        self.assertIntegrityFails("invariant 1 is already used")

    def test_ordered_list_invariant_fails(self):
        self.append("docs/invariants.md", "\n1. An ordered item.\n")
        self.assertIntegrityFails("list item is not of the form")

    def test_invariant_without_test_fails(self):
        self.append("docs/invariants.md", "\n- **99.** No test enforces this.\n")
        self.assertIntegrityFails("invariant 99 names no test")

    def test_invariant_with_missing_test_fails(self):
        self.append("docs/invariants.md", "\n- **99.** A rule.\n  - `tests/test_check_docs.py::RuleTests::test_nope`\n")
        self.assertIntegrityFails("no def test_nope")

    def test_invariant_with_test_under_wrong_class_fails(self):
        self.append("docs/invariants.md", "\n- **99.** A rule.\n  - `tests/test_check_docs.py::BaseTests::test_deletion_needs_doc`\n")
        self.assertIntegrityFails("no def test_deletion_needs_doc in tests/test_check_docs.py::BaseTests")

    def test_python_id_with_non_identifier_fails(self):
        self.append("docs/invariants.md", "\n- **99.** A rule.\n  - `tests/test_check_docs.py::RuleTests::test no`\n")
        self.assertIntegrityFails("nested item is not a test id under an invariant")

    def test_struck_invariant_needs_no_test(self):
        self.append("docs/invariants.md", "\n- **99.** ~~A retired rule.~~ Retired because it stopped holding.\n")
        self.assertPasses()


class VitestIdTests(RepoCase):
    """Test ids in docs/invariants.md for files other than .py."""

    SPEC = "packages/core/src/yuyv.test.ts"

    def setUp(self):
        super().setUp()
        self.write(self.SPEC, """import { describe, expect, it, test } from "vitest";

describe("decodeYUYV", () => {
  describe("thermal half", () => {
    it("reads lo and hi bytes", () => {
      expect(1).toBe(1);
    });
  });
  test(
    'keeps the "image" half',
    () => {},
  );
  it("says \\"don\\'t\\" \\u00e9", () => {});
  it(`template ${1}`, () => {});
  it.each([1, 2])("each %i", () => {});
  it("con" + "cat", () => {});
});

describe("encodeYUYV", () => {
  it("round-trips", () => {});
});
""")

    def add_id(self, test_id: str) -> None:
        self.append("docs/invariants.md", f"\n- **99.** A rule.\n  - `{self.SPEC}::{test_id}`\n")

    def test_vitest_id_passes(self):
        self.add_id("decodeYUYV::thermal half::reads lo and hi bytes")
        for test_id in ('decodeYUYV::keeps the "image" half', "decodeYUYV::says \"don't\" \u00e9",
                        "encodeYUYV::round-trips", "round-trips"):
            self.append("docs/invariants.md", f"  - `{self.SPEC}::{test_id}`\n")
        self.assertPasses()

    def test_vitest_id_with_missing_name_fails(self):
        self.add_id("decodeYUYV::reads nothing")
        self.assertIntegrityFails(f'no it("reads nothing") or test("reads nothing") in {self.SPEC}')

    def test_vitest_id_with_missing_describe_fails(self):
        self.add_id("decode::reads lo and hi bytes")
        self.assertIntegrityFails(f'no describe("decode") in {self.SPEC}')

    def test_vitest_id_out_of_order_fails(self):
        self.add_id("thermal half::decodeYUYV::reads lo and hi bytes")
        self.assertIntegrityFails(f'describe("decodeYUYV") does not come after describe("thermal half") in {self.SPEC}')

    def test_vitest_id_needs_a_plain_literal(self):
        for name in ("template ${1}", "each %i", "con"):
            with self.subTest(name=name):
                self.add_id(f"decodeYUYV::{name}")
                self.assertIntegrityFails(f'no it("{name}") or test("{name}")')
                self.replace("docs/invariants.md", f"\n- **99.** A rule.\n  - `{self.SPEC}::decodeYUYV::{name}`\n", "")

    def test_vitest_id_with_wrong_nesting_passes(self):
        # Known limitation: names are found in order, not in their real nesting.
        # "round-trips" is under encodeYUYV, not under decodeYUYV.
        self.add_id("decodeYUYV::round-trips")
        self.assertPasses()

    def assertIntegrityFails(self, needle: str) -> str:
        out = self.assertFails("integrity")
        self.assertIn(needle, out)
        return out


class OutputTests(RepoCase):
    def test_success_message(self):
        self.touch_makefile()
        self.touch_dev_guide()
        self.commit()
        out = self.assertPasses()
        self.assertRegex(out.strip(), r"^docs-check: 2 changed files since main \([0-9a-f]{7,}\), "
                                      r"each with the documentation it needs$")

    def test_verbose_marks_filtered_files(self):
        self.append("tests/test_check_docs.py", "\n# touched\n")
        out = self.assertPasses("-v")
        self.assertIn("tests/test_check_docs.py  (left out: Test code and test data", out)


class IntegrityOnlyTests(RepoCase):
    def test_integrity_only_needs_no_base(self):
        self.git("branch", "-m", "main", "trunk")
        self.touch_makefile()
        out = self.assertPasses("--integrity-only")
        self.assertRegex(out.strip(), r"^docs-check: integrity checks pass on \d+ files$")

    def test_integrity_only_fails_on_broken_link(self):
        self.append("docs/guides/testing.md", "\nSee [x](missing.md).\n")
        out = self.assertFails("integrity", "--integrity-only")
        self.assertIn("docs-check: integrity checks failed:", out)


class RealRepositoryTests(unittest.TestCase):
    def test_integrity_of_this_repository(self):
        mod = load_check_docs()
        self.assertEqual(mod.integrity(str(REPO)), [])


if __name__ == "__main__":
    unittest.main()
