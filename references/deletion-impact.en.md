# Deletion impact

Before deleting or renaming paths, run `node scripts/deletion-impact.mjs --config deletion.json`. Add installed products, manifests, receipts and records as explicitly authorized read-only `retainedRoots` outside the repository. This command writes nothing; stdout is the full JSON report. `--help` exits zero without configuration.

~~~json
{
  "repo": "/work/project",
  "paths": [
    "src/old.mjs"
  ],
  "retainedRoots": [
    {
      "path": "/work/installed-records",
      "label": "installed"
    }
  ],
  "unusedExclusions": {
    "historyDirectories": [
      "docs/history"
    ],
    "staticDirectories": [
      "public"
    ],
    "conventionLoaded": [
      "**/hook.py"
    ]
  },
  "limits": {
    "maxFileBytes": 4194304,
    "maxTotalBytes": 268435456,
    "maxFiles": 100000,
    "maxEntries": 250000,
    "maxMatches": 100000
  },
  "display": {
    "maxGroupsPerCategory": 20
  }
}
~~~

Supply exactly one of `paths` or `gitRange: "<base>..<head>"`. Git selection includes deletions and old names of detected renames (`git diff -M`); copied files are not deletions. Relative repo/root paths resolve against the config file. Retained roots need unique labels, must be disjoint from the repo and from each other, and are never discovered automatically.

Each deleted path has repository references classified as program, data or declared history, plus retained references grouped by root and file. Search covers every filename extension. `unusedExclusions` follows the 1.21 report declaration shape: history directories classify history; static directories and convention globs annotate references without suppressing them. Optional `exclude` globs apply to relative names in every scope; each omission is listed. Git metadata is excluded and listed.

Any retained hit is always NEEDS_ATTENTION: retained evidence still names the path; execution evidence is required to establish acceptance by the new version. A hit never proves failure or compatibility. No roots, missing/unreadable roots, symlinks and incomplete scans carry UNKNOWN gaps. NO_RETAINED_MATCH means only that the disclosed scanned population contained no literal reference; it never authorizes deletion.

All five limits in the example are positive integers and global across retained roots (in declaration order), then the repository. Oversized files, exhausted total bytes/files, unvisited directory remainders and omitted matches are explicitly listed under `scopes[].skipped`; `stats.limitExceeded` identifies budget exhaustion. Bytes count actual content read, including files classified as binary; enumeration and Git metadata reads are separate. Bounded reads compare file identity, size and modification time before/after reading.

Symlinks and their ancestors are not followed. NUL/control-containing and invalid UTF-8 files are skipped explicitly. UTF-16, basename-only references and computed paths are unsupported. Literal forward slashes, Windows separators and JSON-escaped separators are matched case-sensitively as substrings. Columns refer to normalized slash text. All collected locations and counts are in JSON; snippet text is capped at 240 characters with an explicit flag and full-line hash.

Report config: add `deletionImpact` containing the same selection, retained roots and optional limits/exclusions/display. `report.mjs` supplies the map repo and inherits top-level `unusedExclusions` and `display` unless overridden. `check-card.mjs` supplies `root` when `deletionImpact.repo` is omitted. Relative deletion roots resolve against the CLI config. Both add a chapter to Markdown/HTML and full data to their JSON; existing verdicts and counters remain unchanged. Report/card output paths must be outside all inspected roots.

Display retains the 1.21 grouping rules: same verdict/reason/file within a root; at most 20 groups per category by default, occurrence order and at most three anchors. Omitted group counts and a full-JSON link stay visible. Read failures and budget omissions are not silently converted to clean results. The scanner neither runs inspected code nor verifies runtime compatibility.

[Traditional Chinese](deletion-impact.md)
