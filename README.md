# GML_MCP

An MCP server for GameMaker — giving AI agents a real connection to the engine:
faithful project editing, a compile loop, and live introspection of a running
game.

Status: **M0 and M1a complete.** The `.yy` document model and the
transactional write layer are built and validated.

## Why this exists

Agents writing GameMaker code today are working blind. They hallucinate GML
functions, cannot tell whether their code compiles, cannot see what the game
looks like, and cannot safely edit the project files that define rooms, objects
and sprites. Every one of those is solvable now, without waiting for
GameMaker's forthcoming IDE extension API.

## Architecture

A stable MCP tool surface over swappable drivers, so the IDE plugin can slot in
later without a rewrite:

```
MCP tool layer        (stable — the only thing agents see)
      |
ProjectSource   <- FilesystemSource (today)  | IdePluginSource (later)
RunTarget       <- IgorRunner (today)        | IdeDebugger (later)
LiveSession     <- GmlBridge (today)         | IdeRuntimeAPI (later)
KnowledgeBase   <- GmlSpec.xml + project index
```

Target workflow is **IDE open** — GameMaker detects disk changes and prompts to
reload, so the agent assists while you work. That imposes three constraints:
writes must be batched into one atomic burst (or the IDE prompts per file),
edits must be surgical (unsaved editor buffers can be clobbered), and Igor
builds must use a dedicated cache directory so agent builds never contend with
IDE builds.

## Milestones

| | |
|---|---|
| **M0** | `.yy` document model + corpus harness — done |
| **M1a** | Transactional writes, shadow-git undo — done |
| M1b | `.yyp` graph, resource CRUD, GML symbol index |
| M2 | `GmlSpec.xml` knowledge base, MCP server, first toolset |
| M3 | Igor discovery + probe layer, `compile_check`, isolated build cache |
| M4 | Injectable GML bridge: TCP, screenshots, state introspection |
| M5 | Live tunables, seeded input, GML test runner |

## Transactions and undo

Every write goes through a transaction. It collects the whole change set,
validates it, snapshots the current state, then flushes in one burst:

```ts
const workspace = Workspace.open(projectRoot);
const tx = workspace.begin('add obj_bridge');

const car = tx.readDoc('objects/objCar/objCar.yy')!;  // reads through pending writes
car.set(['persistent'], true);
tx.writeDoc('objects/objCar/objCar.yy', car);
tx.write('objects/obj_bridge/Create_0.gml', 'server = network_create_server_raw(...);');

tx.commit();     // validate -> snapshot -> apply, or roll back
workspace.undo(); // step back, repeatable
```

**Batching is correctness, not tidiness.** Creating one object touches the
`.yy`, the `.yyp` resource list, `.resource_order` and each event `.gml`.
Written one at a time with the IDE open, GameMaker prompts to reload after each
and can reload a half-created resource.

**Validation runs before anything lands.** A `.yy` that does not re-parse is
rejected with the whole change set, because a corrupt `.yy` stops GameMaker
loading the project at all.

**Undo uses a shadow git repo** at `.gml-mcp/shadow.git`, with the project as
its work tree. Deliberately not the user's own repository — running
`git commit` inside someone's working tree while they have their own staged
changes is a bad surprise, and stash collisions are worse. A separate GIT_DIR
costs nothing, gives unlimited undo depth, and behaves identically whether or
not the project is versioned. `core.autocrlf` is forced off: 39% of corpus
files are CRLF and git would otherwise rewrite them on restore.

Each transaction commits the state *before* it applies, so undo restores
modified files, deletes files the transaction created, and brings back files it
deleted.

## The `.yy` format, as measured

Findings from sweeping **35,917 real `.yy`/`.yyp` files** across 131 projects
spanning many GameMaker releases. These drove the design.

**Edits are byte splices, never re-serialization.** A full re-serializer,
tuned against the corpus with a learned rule table, reaches only **81.7%
byte-exact** on current-format files. The residue is not noise — it is genuine
version drift. Stitch (`@bscotch/yy`), which takes the re-serialize approach,
ends up hardcoding exceptions for the exact keys our sweep flagged as
inconsistent (`Channels`, `ConfigValues`) and gating field renames on IDE build
numbers (`$GMSound` v2 drops `bitRate`, renames `type` to `channelFormat`).
That is a treadmill: every GameMaker release adds an entry, and every gap
silently reformats a user's file.

Splicing bytes is 100% faithful *by construction* and version-independent.
Measured on the corpus: **0 parse failures, 0 splice failures.** It also keeps
git diffs minimal, which matters when the IDE is open and when a human is
reviewing what the agent did.

Other measured details, each of which would have broken a naive implementation:

| Finding | Consequence |
|---|---|
| 14,162 of 35,917 files use **CRLF**; 68 carry a **BOM**; none end with a newline | Preserve per-file; never normalize |
| Numbers carry meaningful precision — `"imageSpeed":1.0` | Scalars keep verbatim source text. `JSON.parse`/`stringify` would rewrite every instance in every room |
| Integers exceed `Number.MAX_SAFE_INTEGER` (`"targets":461609314234257646`) | Same — never round-trip through `Number` |
| Font kerning tables use **numeric string keys** (`"100"`) | Never round-trip through a plain JS object, which reorders integer-like keys |
| Keys are sorted case-insensitively, but `_` sorts **above** all letters — hence `"bboxMode"` before `"bbox_bottom"` | Verified on 620,224 objects: plain sort gives 11,570 violations, the `_`→`|` substitution gives 453 (99.93%). Needed only to place *inserted* keys; existing keys are never reordered |
| Old format writes `": "`, current writes `":"`; old omits the final trailing comma | Read both. Insertion supplies the comma a final member never needed |
| 29 files (`*.inherited.yy`, `*.Configs.yy`) are not JSON at all — `1.0.0←GUID\|{json}←GUID\|{json}` | Detected and rejected via `YyUnsupportedFormatError` rather than half-parsed |

## Development

```sh
npm install
npm test

# The corpus is the oracle. Point it at a directory of real GameMaker projects:
GML_MCP_CORPUS=d:/gamedev npm test
```

`test/corpus.test.ts` asserts that every file parses, reproduces byte-for-byte,
survives a scalar replacement without disturbing another byte, and returns to
its original bytes after an insert/remove round trip.

## Prior art

[Stitch](https://github.com/bscotch/stitch) by Butterscotch Shenanigans —
`@bscotch/yy` for project files, plus a GML parser and VS Code extension. Used
as a reference, not a dependency; its version-gate table is a useful record of
GameMaker's schema drift.
