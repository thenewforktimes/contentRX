"""Tests for the Session 15 GitHub mining pipeline.

All tests use synthetic / mocked data so the suite never hits the
GitHub API. Covers the filter cascade + pair extraction + rate-limit
retry handling.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# `external_signal/` isn't a package. Add it to sys.path.
EXT_DIR = Path(__file__).resolve().parent.parent / "external_signal"
if str(EXT_DIR) not in sys.path:
    sys.path.insert(0, str(EXT_DIR))

import github_miner as gm  # noqa: E402


# ═══════════════════════════════════════════════════════════════════════
# Filter: file-type whitelist
# ═══════════════════════════════════════════════════════════════════════


class TestFileTypeInScope:
    def test_jsx_tsx_vue_svelte_are_in_scope(self):
        assert gm.file_type_in_scope("src/Button.tsx")
        assert gm.file_type_in_scope("apps/www/pages/index.jsx")
        assert gm.file_type_in_scope("components/Modal.vue")
        assert gm.file_type_in_scope("src/Alert.svelte")

    def test_mdx_is_in_scope(self):
        assert gm.file_type_in_scope("apps/docs/content/guide.mdx")

    def test_translation_json_is_in_scope(self):
        assert gm.file_type_in_scope("apps/web/public/locales/en.json")
        assert gm.file_type_in_scope("locales/en-US.json")

    def test_non_translation_json_is_out(self):
        assert not gm.file_type_in_scope("package.json")
        assert not gm.file_type_in_scope("tsconfig.json")
        assert not gm.file_type_in_scope("apps/web/src/config.json")

    def test_markdown_only_in_docs_or_content(self):
        assert gm.file_type_in_scope("docs/getting-started.md")
        assert gm.file_type_in_scope("apps/www/content/guide.md")
        assert not gm.file_type_in_scope("README.md")
        assert not gm.file_type_in_scope("src/Button.md")

    def test_po_and_xlf_are_in_scope(self):
        assert gm.file_type_in_scope("locales/en.po")
        assert gm.file_type_in_scope("localization/messages.xlf")

    def test_arbitrary_files_are_out(self):
        assert not gm.file_type_in_scope("src/utils.py")
        assert not gm.file_type_in_scope("LICENSE")
        assert not gm.file_type_in_scope("yarn.lock")
        assert not gm.file_type_in_scope("")


# ═══════════════════════════════════════════════════════════════════════
# Filter: commit-message soft tags
# ═══════════════════════════════════════════════════════════════════════


class TestCommitMessageSoftTagged:
    def test_matches_plan_spec_examples(self):
        assert gm.commit_message_soft_tagged("fix typo in readme")
        assert gm.commit_message_soft_tagged("clarify copy on onboarding page")
        assert gm.commit_message_soft_tagged("update empty state on dashboard")
        assert gm.commit_message_soft_tagged("improve error message for 500")
        assert gm.commit_message_soft_tagged("soften tone on the delete modal")
        assert gm.commit_message_soft_tagged("rewrite for clarity")

    def test_case_insensitive(self):
        assert gm.commit_message_soft_tagged("FIX TYPO: lowercase")
        assert gm.commit_message_soft_tagged("Improve Error message here")

    def test_non_copy_commits_rejected(self):
        assert not gm.commit_message_soft_tagged("add new feature")
        assert not gm.commit_message_soft_tagged("refactor module")
        assert not gm.commit_message_soft_tagged("bump dependency")
        assert not gm.commit_message_soft_tagged("")

    def test_substring_match_tolerant(self):
        # Message can have anything before/after the tag.
        assert gm.commit_message_soft_tagged(
            "docs(form): clarify copy and add new examples"
        )


# ═══════════════════════════════════════════════════════════════════════
# Pair extraction from unified diff
# ═══════════════════════════════════════════════════════════════════════


def _diff(lines: list[str]) -> str:
    return "\n".join(lines)


class TestExtractPairsFromPatch:
    def test_single_line_string_change(self):
        patch = _diff([
            "@@ -1,3 +1,3 @@",
            " const error = {",
            "-  message: 'Something broke'",
            "+  message: 'Something went wrong. Try again.'",
            " };",
        ])
        pairs = gm.extract_pairs_from_patch(patch)
        assert len(pairs) == 1
        assert pairs[0]["old"] == "Something broke"
        assert pairs[0]["new"] == "Something went wrong. Try again."

    def test_skips_identical_strings(self):
        patch = _diff([
            "@@ -1,1 +1,1 @@",
            "-const x = 'hello'",
            "+const x = 'hello'",
        ])
        assert gm.extract_pairs_from_patch(patch) == []

    def test_handles_double_quoted_strings(self):
        patch = _diff([
            "@@ -1,1 +1,1 @@",
            '-toast.error("Failed to save")',
            '+toast.error("Couldn\'t save. Try again.")',
        ])
        pairs = gm.extract_pairs_from_patch(patch)
        assert len(pairs) == 1
        assert pairs[0]["old"] == "Failed to save"

    def test_rejects_version_bumps_as_noise(self):
        patch = _diff([
            "@@ -1,1 +1,1 @@",
            "-version: '1.2.0'",
            "+version: '1.2.1'",
        ])
        assert gm.extract_pairs_from_patch(patch) == []

    def test_rejects_url_changes_as_noise(self):
        patch = _diff([
            "@@ -1,1 +1,1 @@",
            "-href: 'https://old.example.com'",
            "+href: 'https://new.example.com'",
        ])
        assert gm.extract_pairs_from_patch(patch) == []

    def test_rejects_hex_sha_changes_as_noise(self):
        patch = _diff([
            "@@ -1,1 +1,1 @@",
            "-commit: 'abc123def456'",
            "+commit: 'fed654cba321'",
        ])
        assert gm.extract_pairs_from_patch(patch) == []

    def test_rejects_wildly_different_lengths_as_noise(self):
        patch = _diff([
            "@@ -1,1 +1,1 @@",
            "-x = 'short'",
            "+x = 'a much longer string that is clearly a different kind of change entirely not copy work'",
        ])
        assert gm.extract_pairs_from_patch(patch) == []

    def test_multiple_strings_same_line_pair_positionally(self):
        patch = _diff([
            "@@ -1,1 +1,1 @@",
            "-const a = 'old_one'; const b = 'old_two';",
            "+const a = 'new_one'; const b = 'new_two';",
        ])
        pairs = gm.extract_pairs_from_patch(patch)
        olds = {p["old"] for p in pairs}
        news = {p["new"] for p in pairs}
        assert olds == {"old_one", "old_two"}
        assert news == {"new_one", "new_two"}

    def test_empty_patch(self):
        assert gm.extract_pairs_from_patch("") == []

    def test_patch_with_no_string_changes(self):
        patch = _diff([
            "@@ -1,3 +1,3 @@",
            "-function foo() {",
            "+function bar() {",
            " }",
        ])
        assert gm.extract_pairs_from_patch(patch) == []


# ═══════════════════════════════════════════════════════════════════════
# Allow-list loading
# ═══════════════════════════════════════════════════════════════════════


class TestLoadAllowList:
    def test_loads_repo_list(self, tmp_path):
        p = tmp_path / "allow.json"
        p.write_text(json.dumps({
            "repos": [
                {"owner": "a", "name": "b", "license": "MIT"},
                {"owner": "c", "name": "d", "license": "Apache-2.0"},
            ],
        }))
        repos = gm.load_allow_list(p)
        assert len(repos) == 2
        assert repos[0]["owner"] == "a"

    def test_real_allow_list_has_seventeen_repos(self):
        # 2026-05-06: pre-merge license audit (ADR
        # 2026-05-06-sources-page-retired) removed three entries from
        # the committed allow-list because they fall outside the
        # MIT/Apache/BSD/CC0/ISC envelope the new /ethics
        # Commitment 4 ("Sources I have rights to use") commits to:
        #   - calcom/cal.com    (AGPL-3.0)
        #   - getsentry/sentry  (BUSL-1.1)
        #   - mdn/content       (CC-BY-SA-2.5)
        # No data had been mined from those repos. The remaining 17
        # are MIT or Apache-2.0.
        repos = gm.load_allow_list(gm.DEFAULT_ALLOW_LIST)
        assert len(repos) == 17
        for r in repos:
            assert r["license"] in {"MIT", "Apache-2.0"}, (
                f"{r['owner']}/{r['name']} has license {r['license']}, "
                "outside the post-2026-05-06 audit envelope"
            )


# ═══════════════════════════════════════════════════════════════════════
# last_crawled_sha (incremental mining)
# ═══════════════════════════════════════════════════════════════════════


class TestLastCrawledSha:
    def test_missing_file_returns_none(self, tmp_path):
        assert gm.last_crawled_sha(tmp_path / "nope.json") is None

    def test_empty_commits_returns_none(self, tmp_path):
        p = tmp_path / "out.json"
        p.write_text(json.dumps({"commits": []}))
        assert gm.last_crawled_sha(p) is None

    def test_returns_first_sha(self, tmp_path):
        p = tmp_path / "out.json"
        p.write_text(json.dumps({
            "commits": [
                {"sha": "newest"}, {"sha": "older"},
            ]
        }))
        assert gm.last_crawled_sha(p) == "newest"


# ═══════════════════════════════════════════════════════════════════════
# mine_repo — end-to-end with mocked client
# ═══════════════════════════════════════════════════════════════════════


class TestMineRepo:
    def test_filters_and_writes_output(self, tmp_path):
        client = MagicMock()
        # Two commits: one copy work, one refactor. Only the first
        # should survive the cascade.
        client.commit_history.return_value = [
            {
                "oid": "sha-copy",
                "messageHeadline": "fix typo in error message",
                "messageBody": "",
                "committedDate": "2026-04-22T10:00:00Z",
            },
            {
                "oid": "sha-refactor",
                "messageHeadline": "refactor the API",
                "messageBody": "",
                "committedDate": "2026-04-21T10:00:00Z",
            },
        ]
        client.commit_diff.return_value = {
            "files": [
                {
                    "filename": "src/error.tsx",
                    "patch": _diff([
                        "@@ -1,1 +1,1 @@",
                        "-message: 'An error occurred'",
                        "+message: 'Something went wrong. Try again.'",
                    ]),
                }
            ]
        }

        summary = gm.mine_repo(
            client,
            {"owner": "acme", "name": "web", "license": "MIT"},
            output_dir=tmp_path,
            sleep_fn=lambda _: None,  # no delays in tests
            per_commit_delay=0,
        )

        assert summary["commits_checked"] == 2
        assert summary["commits_retained"] == 1
        assert summary["total_pairs"] == 1

        out_file = tmp_path / "acme__web.json"
        assert out_file.exists()
        with open(out_file) as f:
            data = json.load(f)
        assert data["repo"] == "acme/web"
        assert data["license"] == "MIT"
        assert len(data["commits"]) == 1
        assert data["commits"][0]["sha"] == "sha-copy"

    def test_skips_out_of_scope_files(self, tmp_path):
        client = MagicMock()
        client.commit_history.return_value = [
            {
                "oid": "sha1",
                "messageHeadline": "fix typo",
                "messageBody": "",
                "committedDate": "2026-04-22T10:00:00Z",
            },
        ]
        client.commit_diff.return_value = {
            "files": [
                {
                    "filename": "package.json",  # NOT in scope
                    "patch": _diff([
                        "@@ -1,1 +1,1 @@",
                        "-  \"name\": \"old\"",
                        "+  \"name\": \"new\"",
                    ]),
                }
            ]
        }
        summary = gm.mine_repo(
            client,
            {"owner": "acme", "name": "web", "license": "MIT"},
            output_dir=tmp_path, sleep_fn=lambda _: None, per_commit_delay=0,
        )
        # Commit's message passed the tag filter, but no in-scope files.
        assert summary["commits_retained"] == 0

    def test_incremental_crawl_passes_prior_sha(self, tmp_path):
        # Seed a prior output.
        out_file = tmp_path / "acme__web.json"
        out_file.write_text(json.dumps({
            "commits": [{"sha": "prior-sha", "pairs": []}],
        }))

        client = MagicMock()
        client.commit_history.return_value = []
        gm.mine_repo(
            client,
            {"owner": "acme", "name": "web", "license": "MIT"},
            output_dir=tmp_path, sleep_fn=lambda _: None, per_commit_delay=0,
        )
        # Client should have been asked for commits AFTER prior-sha.
        _, kwargs = client.commit_history.call_args
        assert kwargs["since_sha"] == "prior-sha"


# ═══════════════════════════════════════════════════════════════════════
# GitHubClient — auth + retry
# ═══════════════════════════════════════════════════════════════════════


class TestGitHubClient:
    def test_missing_token_raises(self):
        with pytest.raises(gm.GitHubError):
            gm.GitHubClient(token=None)

    def test_cache_hit_short_circuits(self, tmp_path):
        client = gm.GitHubClient(token="x", cache_dir=tmp_path)
        cache_key = "GET https://api.github.com/test {}"
        client._cache_set(cache_key, {"hello": "world"})
        # Without mocking urlopen, a cache miss would try to hit the
        # network. A cache hit returns without touching urllib.
        result = client._request(
            "GET", "https://api.github.com/test",
        )
        assert result == {"hello": "world"}

    def test_retries_on_rate_limit(self, tmp_path):
        import urllib.error
        client = gm.GitHubClient(
            token="x", cache_dir=tmp_path,
            sleep_fn=lambda _: None,
        )
        call_count = {"n": 0}
        def fake_urlopen(req, timeout=30):
            call_count["n"] += 1
            if call_count["n"] < 3:
                raise urllib.error.HTTPError(
                    url=req.full_url, code=429, msg="rate", hdrs=None, fp=None,
                )
            response = MagicMock()
            response.__enter__ = lambda self: response
            response.__exit__ = lambda *_: None
            response.read = lambda: b'{"ok": true}'
            return response
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = client._request(
                "GET", "https://api.github.com/test",
                use_cache=False,
            )
        assert result == {"ok": True}
        # Two 429s, third succeeds.
        assert call_count["n"] == 3

    def test_raises_after_max_retries(self, tmp_path):
        import urllib.error
        client = gm.GitHubClient(
            token="x", cache_dir=tmp_path,
            sleep_fn=lambda _: None,
        )
        def fake_urlopen(req, timeout=30):
            raise urllib.error.HTTPError(
                url=req.full_url, code=429, msg="rate", hdrs=None, fp=None,
            )
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            with pytest.raises(gm.GitHubError):
                client._request(
                    "GET", "https://api.github.com/test",
                    use_cache=False, max_retries=2,
                )
