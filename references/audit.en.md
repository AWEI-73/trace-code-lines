# Audit a complete round

Run discovery once, fill questions and authorize record roots, then run the round once:

~~~text
node scripts/audit.mjs --init /work/repo --out /work/audit-config.json
node scripts/audit.mjs --config /work/audit-config.json
~~~

The initializer reuses discover-entries and lists entry anchors, version-pointer candidates, map roots, existing tests and record-root candidates. It lists only repository directories and absolute path values explicitly present in repository JSON configuration; it never follows these external candidates. Candidates confer no authorization. Fill questions and recordRoots; repo, pins.head, writeRoot, limits and suggested mapRoots are generated. The output directory must be outside the repository and every read-only record root. Existing audit outputs are never overwritten.

~~~json
{
  "repo": "/work/repo",
  "pins": {"head": "FULL_GIT_COMMIT"},
  "writeRoot": "/work/audit-output",
  "recordRoots": [{"label": "journal", "path": "/work/records"}],
  "questions": [
    {"id": "assertions", "ask": "Do the declared assertions pass?", "anchors": ["src/main.mjs#run"], "tests": ["tests/main.test.mjs"]},
    {"id": "retained", "ask": "What is retained?", "records": [{"root": "journal", "files": ["events.jsonl", "snapshot.json"], "kindField": "kind", "fields": ["status"], "trigger": {"kind": "complete"}, "metrics": [{"name": "total", "file": "snapshot.json", "selector": "items", "op": "length"}]}]},
    {"id": "remove", "ask": "Who names this path?", "deletePaths": ["src/old.mjs"]}
  ]
}
~~~

Remove the example pin or replace it with the actual full commit. Optional pins.files contains {path,sha256} repository-relative byte pins. An anchor is a relative file, file#literalSymbol, or {file?,symbol?,line?,expect?}. Symbols are literal line matches, not a semantic symbol resolver. mapRoots entries are {path,reason?}; all available deletePaths, anchor files and specified tests become required roots before the root limit, even when these alone exceed maxMapRoots. Only other entry roots fill the remaining slots; mapSelection and skipped list their exact omitted paths. init retains the full candidate list. Version-chain reads package versions and skill frontmatter; complex chains can be explicitly supplied as versionChain with existing version-chain configuration. Candidate current/release pointers are advisory, not guessed historical bindings.

Records are selected only under labeled authorized roots. files is an exact relative file list; omitted means JSON/JSONL files in the bounded root. The adapter auto-detects complete JSON, arrays, or JSONL, stages normalized objects, and reuses record-census with kind grouping. Optional items selects an array in a JSON object. A kind sets the trigger selector; trigger explicitly selects typed fields. fields requests census cross fields. Missing kinds, fields, roots, parse failures and historical versions remain gaps. No snapshots or identical objects are deduplicated into unique events. Metrics apply to whole JSON documents and support value, length, sum (array field), distinct (array field); every metric includes its file and selector. They measure saved data and do not implement project-specific eligibility, lineage, policy or replay semantics.

Only explicitly listed existing Node test files run. The orchestrator copies the complete bounded Git-tracked population, verifies each copy hash, and reuses run-once/instrument with credential-free environment, network deny, this Node executable only, isolated HOME/TEMP and cleanup receipts. It installs no dependencies and launches no models. Other test languages/runners become UNKNOWN. Each test uses a separate copy; copies are removed after receipts and transcripts are saved. API hooks are not an OS sandbox: native code, worker threads, deliberate unhooking and detached processes remain limitations. Review existing test behavior before authorizing it.

Outputs: audit.md and audit.json form one card, with per-question verdicts, anchors, source hashes, populations, gaps, commands and exit codes. Imported existing functions have exitCode=null and resultStatus, never a fabricated process exit. Under run-* are source manifests, version-chain, static map, normalized records, census, deletion-impact, transcripts, run-once archives and the ordinary report. The report receives a SHA-256-bound trace-audit-tests-v1 bundle via testEvidence:{path,sha256}; it recomputes classifications from transcripts and adds a test-failure chapter to Markdown, HTML and JSON. Existing static verdicts and counters are preserved. An audit invocation may complete with FAIL/UNKNOWN questions; CLI exit zero only means orchestration completed.

PASS means actual assertions passed within the named test scope. Observed failing assertions produce FAIL with environment denial details. An existing anchor plus zero explicit trigger counts can yield EXISTS_NOT_TRIGGERED (displayed in Traditional Chinese), only in the disclosed population. Static-only questions, records without execution binding, deletion compatibility, missing data, incomplete runs and successful commands without assertions remain UNKNOWN. Evidence ordering is real use > AGENT_DRIVEN_STUBBED > executed tests > static. Retained records are labeled separately because provenance and historical version binding are not inferred. This adapter does not generate stubs or scenarios and never promotes retained counts to verified live use.

limits accepts positive integers: maxFiles=20000, maxEntries=100000, maxFileBytes=2097152, maxTotalBytes=268435456, maxRecords=100000, maxQuestions=50, maxTests=20 (per question), maxMapRoots=8, timeoutMs=120000 (per subprocess), minFreeBytes=6442450944. File/byte limits apply to each source or record population; deletion-impact receives its own global retained-plus-repo budget. Source truncation disables copying/tests and mapping rather than feeding an incomplete source into those tools. Every omitted question, test, record, root and scan remainder is listed. Space is checked before heavy steps. No symlinks are followed. Source/record changes and pin mismatches stop the run. Missing record roots are UNKNOWN; a blank recordRoots list does not guess external disks.

[Traditional Chinese](audit.md)

Markdown shows at most 20 gap groups per question/record section, with explicit omitted counts; JSON retains every gap. Deletion questions show source-path presence and representative repository/retained anchors.

## Deletion questions in 1.23.1

Each deletion question starts with a Traditional Chinese numeric summary. deletion.summary contains programImports (distinct non-test importer files), stringReferences (repository full-path literal occurrences outside matched import specifier tokens), tests (distinct test files found through imports, literal references or explicitly specified tests present in the source snapshot), and retainedFiles (distinct retained root/file pairs). File counts deduplicate across targets; string occurrences are counted per target. These are observed counts within disclosed populations, not global totals when scans are incomplete.

The same derive-map invocation accepts importTargets and adds incomingImports: a direct lexical import inventory over readable Git-tracked JS/TS and Python files, using the existing parsers and resolvers without executing inspected code. This supplements forward closures so callers outside selected entry closures can be found. incomingImports stores targets, scannedFiles, edges, gaps and scope; source hashes and the map integrity readback bind the inventory to that run. Relative paths, omitted extensions, index resolution, literal dynamic imports and require use existing map resolution. Existing parser limitations, computed imports, aliases and unresolved/deleted targets remain limitations.

For every deletePath, items[].imports merges all matching STATIC_IMPORT and DYNAMIC_IMPORT edges from closures and incomingImports, deduplicates locations, and marks isTest. Markdown lists every importer with file:line, kind/operation and specifier; test imports have a separate label. importEvidence binds the map path and SHA-256, discloses scope, scanned-file and gap counts, and explicitly says NO_MAP_EDGE or MAP_UNAVAILABLE when no edge or no usable same-run map exists. Neither result means unused. items[].stringReferences is the separate counted literal view; the original repo evidence, statuses and verdicts remain unchanged. Per-item summary omits question-only tests, which are included once in the question summary. Full JSON retains every location and the original deletion-impact evidence.

The standalone deletion-impact command remains a literal full-path scanner. Use audit to combine import edges and strings. Deletion questions remain UNKNOWN for operation/compatibility; no count authorizes deletion.

Symbol-only anchors that resolve to source files also become required roots. A deletion question omitted by maxQuestions still displays a numeric observed-count summary with summaryStatus=NOT_RUN; zeros in this case record no observations, not zero dependents.
