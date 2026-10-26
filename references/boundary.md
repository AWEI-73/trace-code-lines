# Dependency direction across zones

Run with Node 22+ and Git. Target code is read, never executed or imported.

~~~text
node scripts/boundary.mjs --config boundary.json
node scripts/boundary.mjs --config boundary.json --out boundary-result.json
~~~

The optional output must be a new file outside every zone repository. Symlink ancestors and overwrites are rejected. Without --out, stdout is the complete JSON; with --out it is a compact receipt containing the absolute outputs.boundary path. Errors go to stderr with exit 1. Exit 2 means the source integrity check failed. Exit 0 means analysis completed, not that all directions are allowed.

## Configuration

~~~json
{
  "zones": [
    {"name": "client", "repo": "/absolute/app-repo", "include": ["client/**"]},
    {"name": "server", "repo": "/absolute/app-repo", "include": ["server/**"]},
    {"name": "engine", "repo": "/absolute/engine-repo", "include": ["engine/**"]}
  ],
  "rules": [
    {"from": "client", "to": "server", "allow": true, "markers": []},
    {"from": "client", "to": "engine", "allow": false, "markers": ["engineRoot", "engine/lib"]},
    {"from": "engine", "to": "client", "allow": "declared", "markers": ["snapshotRoot", "pack.entry"]}
  ]
}
~~~

Each repository must exist and have a Git HEAD. Zone names and from/to pairs must be unique. Include globs use / separators: * matches within a path component, ** crosses components, **/ also matches zero directories, and ? matches one non-separator. Overlapping membership of a tracked path is an error. No rule or marker is built in for any project.

## Classification

| Classification | Evidence |
| --- | --- |
| VIOLATION | A resolved cross-zone edge or marker-directed path conflicts with allow:false. |
| DECLARED | The direction uses allow:"declared" and at least one configured marker occurs in the path expression or a supported backward binding. |
| ALLOWED | A known direction has allow:true. This is a configured direction classification only. |
| UNKNOWN | No matching marker/target, no direction rule, missing declaration marker, or markers point to multiple target zones. Each ambiguous target remains visible. |

Markers in one rule are alternatives (OR). Identifier markers match complete tokens; dotted markers match complete member sequences, including a suffix such as pack.entry in this.pack.entry. Literal fragments match substrings of string/template tokens in path expressions. Comments, unrelated source strings and regex literals are not path calls. Matching a marker is lexical routing evidence; it does not evaluate the path, verify a deployed declaration, or prove runtime execution.

## Static and dynamic coverage

Same-repository static imports, exports, Python imports and literal require/import calls reuse walker.mjs resolution. Only resolved cross-zone targets produce static findings. Dynamic cross-repository paths use configured markers; the tool does not follow guessed external paths.

The lexical path scanner recognizes import(...), require(...), readFileSync/readFile, spawn/spawnSync/execFile/execFileSync/fork, including ordinary member spellings. Reads inspect the first argument. Spawn-like calls inspect the executable and second argv argument (a lexical path candidate, not argument semantics); options and encoding fields are excluded. Custom wrappers and imported aliases are not resolved by this scanner.

Backward binding follows a name with a single preceding assignment in its lexical function or enclosing scope, up to eight hops. Enclosing immutable-looking captures support a map callback that imports from an outer base variable. Parameter shadowing, multiple/forward assignments, compound updates, function-valued bindings and object-property expansion do not invent a value. Binding anchors retain the assignment line and hash. This is not control-flow proof: conditional assignments, runtime object mutation, destructuring, type syntax and unusual lexical forms remain limitations; direct markers remain signals even when additional values are unknown.

Python recognizes importlib.import_module, importlib.util.spec_from_file_location (the file argument), sys.path.insert/append/extend, and sys.path assignment. Unresolved expressions stay UNKNOWN. Python aliases, imported helpers, dynamic scope changes and arbitrary computation are not evaluated. Existing walker gaps remain in scope.parserGaps. JS template contents are marker signals, not a complete parser for embedded code; escaped literals and regex syntax retain lexical limitations.

## Evidence envelope and negative observations

Each finding includes from/to zones, repository, file, line/endLine/column, snippet, snippetSha256, sourceSha256, kind, matchedMarkers, configured rule index, basis, bindings, gaps, severity and runtimeVerified:false. A resolved static result also has target and specifier. Hashes use the exact returned UTF-8 snippet and source bytes. Stable IDs distinguish call columns and target paths.

scope.fileCount is the number of selected readable supported source files. scope.zones lists those files and include patterns. scope.skippedFiles names tracked files outside the includes, unsupported files, unreadable/oversized/linked files, and untracked nonignored files with reasons. Git-ignored paths are outside the population and are not enumerated. The existing walker's bounded traversal and resolution gaps are preserved under scope.parserGaps; they limit static completeness even though the independent lexical scanner visits the selected files.

readOnly hashes the readable tracked inventory before and after scanning and checks Git HEAD and working status. Dirty inputs are described by their actual bytes and status; HEAD alone does not identify those bytes. Integrity failure prevents a trustworthy result. Configuration SHA-256 binds the supplied JSON object; it is not an approval record.

status describes analysis completeness: PARTIAL means unresolved findings or parser gaps, PASS means no such known analysis gaps, and STOPPED_INTEGRITY_FAILURE means source drift. Counts of VIOLATION are separate. A zero count includes negativeConclusion with file count, skipped count, unknown count and parser-gap count. Always carry the full scope and limitations with any negative observation; no result authorizes deletion or promises safety.

## Maintenance and check-card use

Attach the finding and its scope/readOnly evidence to the existing agent-authored maintenance or check-card review. severity maps VIOLATION to needs-attention, UNKNOWN to uncertain, and other classifications to informational. An agent must still inspect the source and rule, explain the failure scenario and propose a lawful next step. There is no automatic change to existing report builders, no new broken count, and no promotion from lexical classification to observed failure.

The self-test contains synthetic cases; real calibration repositories, configurations, snippets and demo outputs are excluded from public packages.
