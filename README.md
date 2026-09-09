# GML_MCP

An MCP server for GameMaker — giving AI agents a real connection to the engine:
faithful project editing, a compile loop, and live introspection of a running
game.

Status: **M2 complete — the server runs.** An agent can search the GML API,
check its own code for invented functions, and edit a project through
transactional tools with undo.

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
| **M1b** | `.yyp` graph, resource CRUD, folders, events — done |
| M1c | GML symbol index; sprite creation once an image pipeline exists |
| **M2** | `GmlSpec.xml` knowledge base, hallucination checker, MCP server — done |
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

## Running it

```sh
npm install && npm run build
node dist/mcp/cli.js --project path/to/YourGame
```

Register it with an MCP client (Claude Code shown):

```json
{
  "mcpServers": {
    "gml": {
      "command": "node",
      "args": ["path/to/GML_MCP/dist/mcp/cli.js", "--project", "path/to/YourGame"]
    }
  }
}
```

### Tools

| Tool | |
|---|---|
| `gml_search` | Find GML functions by name or description |
| `gml_lookup` | Full signature, parameter types and docs for one identifier |
| `gml_check` | Report calls to functions that exist nowhere |
| `gml_project_info`, `gml_list_resources`, `gml_read`, `gml_list_events` | Read the project |
| `gml_create_object`, `gml_create_script`, `gml_create_folder` | Add resources |
| `gml_set_event`, `gml_remove_event` | Write gameplay logic |
| `gml_set_sprite_properties`, `gml_rename_resource`, `gml_delete_resource` | Edit and remove |
| `gml_undo`, `gml_history` | Step back through changes |

Every mutation is one transaction with a named restore point, so `gml_undo`
reverses whole operations rather than individual file writes.

## Grounding, not preloading

The GML reference is exposed through search and lookup rather than loaded into
context. Measured on a real `GmlSpec.xml`:

| Representation | ~tokens |
|---|---|
| Raw `GmlSpec.xml` | 368,000 |
| Distilled to signatures + descriptions + parameter docs | 198,000 |
| Signatures only | 39,000 |
| Names only | 11,600 |
| **One `gml_lookup` result** | **80–200** |

Preloading would buy one saved round-trip at roughly a thousand times the
cost, and would displace the project's own code — the thing the agent actually
needs to reason about.

But search alone cannot fix hallucination, because a confident agent never
asks. So `gml_check` validates after the fact, and `gml_set_event` runs it
automatically on the code it just wrote:

```
Wrote objects/objPlayer/Step_0.gml
objects/objPlayer/Step_0.gml:2:1  Unknown function 'instance_create_layerr'
  (did you mean instance_create_layer?)
```

The checker is tuned to be conservative — one that cries wolf teaches an agent
to ignore its real findings. Measured across **15,952 `.gml` files in 66 real
projects**, the false positives it surfaced drove four fixes: extension APIs
(Steamworks alone declares hundreds of functions present in no `.gml` and no
runtime spec), struct and constructor methods called bare by sibling methods,
`#region` labels whose free text parsed as calls, and functions declared in
the file being checked but not yet on disk. That took it from 3,126
diagnostics to **309**, with 49 of 66 projects fully clean. Spot-checking the
remainder found genuine dangling calls — functions invoked but defined nowhere.

The spec is read from the user's own install, so it always matches the runtime
they have, and nothing of GameMaker's documentation is redistributed.

## Resources

```ts
const project = GmProject.open(root);

project.transact('add an enemy', (tx) => {
  createFolder(project, tx, 'Actors/Enemies');
  createObject(project, tx, 'objSlime', {
    folder: 'Actors/Enemies',
    sprite: 'sprSlime',
    events: [
      { event: Events.create(), code: 'hp = 3;' },
      { event: Events.collision('objBullet'), code: 'hp -= 1;' },
    ],
  });
});

renameResource(project, tx, 'sprSlime', 'sprBlob'); // rewrites every reference
deleteResource(project, tx, 'sprBlob');             // refuses while referenced
```

Each operation stages into a transaction, so several compose into one atomic
change set. A create touches the `.yy`, the `.yyp` `resources` array, and
`.resource_order` when the project has one — older projects do, newer
GameMaker versions dropped it, so it is written only when already present.

**References are resolved structurally.** `spriteId`, `parentObjectId`,
`collisionObjectId` and room instance `objectId` are all `{name, path}`
objects, so a rename rewrites them by walking the document tree rather than
by text substitution. Delete refuses while anything still points at the target
unless forced. The `.yyp`'s own `resources`, `Folders` and `IncludedFiles`
sections are excluded from that search: they catalogue resources rather than
refer to them, and counting them would make every resource look permanently
referenced.

**New files copy the project's conventions instead of guessing.** GameMaker
versions its `$GMType` marker keys per resource type and changes them over
time — the same project can hold `"$GMScript":"v1"` and `"$GMObject":""`, and
another uses `"$GMSprite":"v2"`. Rather than map IDE build numbers to tag
values, a new resource reads the tag from a resource of the same kind already
in the project.

### Events

The `eventType` to file-prefix table was derived from the corpus rather than
from documentation: pairing `eventList` entries against sibling `.gml` files
across **4,975 objects** produced exactly one prefix per type with no
disagreements.

| | | | |
|---|---|---|---|
| 0 Create | 1 Destroy | 2 Alarm | 3 Step |
| 4 Collision | 5 Keyboard | 6 Mouse | 7 Other |
| 8 Draw | 9 KeyPress | 10 KeyRelease | 12 CleanUp |

Types 11 (Trigger, deprecated), 13 (Gesture) and 14 (PreCreate) never occurred
and are marked unverified in the source. Collision events are named after the
other object — `Collision_objWall.gml` — not a number.

### Sprites

Sprite properties (`origin`, `bboxMode`, `collisionKind`, the bbox) are
editable. Sprite *creation* is deliberately absent: it needs frame and layer
GUIDs, PNGs written to two locations, and a large `sequence` block — 3KB of
`.yy` for a single-frame sprite — and there is no way to exercise that end to
end until there is an image pipeline feeding it. When it lands, cloning an
existing sprite's structure will beat synthesizing the `sequence` block.

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

# Two opt-in suites run against real data:
GML_MCP_CORPUS=d:/gamedev npm test                  # format fidelity, 35,917 files
GML_MCP_SAMPLE_PROJECT=path/to/project npm test     # resource ops on a real project
```

`test/corpus.test.ts` asserts that every file parses, reproduces byte-for-byte,
survives a scalar replacement without disturbing another byte, and returns to
its original bytes after an insert/remove round trip.

`test/integration.test.ts` copies a real project and runs the resource
operations over it, checking that a create touches only the expected files and
that undo restores every byte. It has been run against seven projects,
including one using nested folders and one nearly empty.

## Prior art

[Stitch](https://github.com/bscotch/stitch) by Butterscotch Shenanigans —
`@bscotch/yy` for project files, plus a GML parser and VS Code extension. Used
as a reference, not a dependency; its version-gate table is a useful record of
GameMaker's schema drift.
