# GameMaker MCP Server

**Give an AI agent a real connection to GameMaker** — faithful project editing,
a compile loop, and a live link into the running game.

![MCP](https://img.shields.io/badge/MCP-server-5b3df5)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6)
![Node](https://img.shields.io/badge/Node-20%2B-339933)
![Tests](https://img.shields.io/badge/tests-191%20passing-2ea44f)
![License](https://img.shields.io/badge/license-MIT-blue)

Agents writing GameMaker code today work blind. They invent GML functions that
do not exist, cannot tell whether the code compiles, cannot see what the game
looks like, and cannot safely touch the `.yy` files that define rooms, objects
and sprites. This fixes all four.

| | |
|---|---|
| ![Raycaster corridor](docs/images/doom-corridor.png) | ![Platformer jump](docs/images/platformer-jump.png) |

Both of those are games the server built — sprites, objects, events, rooms and
all — then compiled, launched, played and photographed. No imported assets, no
hand-edited files.

---

## Contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
- [See it work](#see-it-work)
- [Tools](#tools)
- [The live bridge](#the-live-bridge)
- [The document model](#the-document-model)
- [Transactions and undo](#transactions-and-undo)
- [Rooms](#rooms)
- [Testing game behaviour](#testing-game-behaviour)
- [Compiling and checking](#compiling-and-checking)
- [What was measured](#what-was-measured)
- [Development](#development)
- [Prior art and attribution](#prior-art-and-attribution)
- [Licence](#licence)

---

## Quick start

### 1. What you need

- **Node 20 or newer**
- **GameMaker**, with at least one runtime installed. The server reads the GML
  function database from your runtime and drives GameMaker's own compiler, so
  it matches the version you actually build with.
- **A GameMaker project** to work on. Any project with a `.yyp` will do.
- An **MCP-capable LLM client** — Claude Code, Claude Desktop, or anything else
  that speaks MCP over stdio.

### 2. Install the server

```sh
git clone https://github.com/jhalek90/Gamemaker-MCP-Server
cd Gamemaker-MCP-Server
npm install
npm run build
```

### 3. Check it can see your project

Before wiring it into anything, make sure it opens your project:

```sh
node dist/mcp/cli.js --project "C:/path/to/YourGame"
```

It should print something like this to stderr and then sit waiting for MCP
traffic — that is correct, it is a stdio server:

```
gml-mcp: YourGame (63 resources)
```

Press `Ctrl+C` to stop. If it cannot find the project it will say so and exit.
The project path can also come from the `GML_MCP_PROJECT` environment variable,
or it defaults to the current directory.

### 4. Connect it to your LLM

**Claude Code** — one command:

```sh
claude mcp add gml -- node "C:/path/to/Gamemaker-MCP-Server/dist/mcp/cli.js" --project "C:/path/to/YourGame"
```

**Claude Desktop** — add this to `claude_desktop_config.json`
(`%APPDATA%\Claude\` on Windows, `~/Library/Application Support/Claude/` on
macOS):

```json
{
  "mcpServers": {
    "gml": {
      "command": "node",
      "args": [
        "C:/path/to/Gamemaker-MCP-Server/dist/mcp/cli.js",
        "--project",
        "C:/path/to/YourGame"
      ]
    }
  }
}
```

**Any other MCP client** — it is a standard stdio MCP server. Command is
`node`, arguments are the path to `dist/mcp/cli.js` plus `--project <your
project>`. Restart the client after editing its config.

### 5. Try it

Open a chat with your model and ask for something. A first prompt that
exercises most of the server:

> Use the GameMaker tools. Tell me what project I have open and how many
> resources it has. Then search GML for functions about collisions, create a
> script called `scr_hello` that logs a message, check it for invented
> functions, and compile the project.

You should see it call `gml_project_info`, `gml_search`, `gml_create_script`,
`gml_check` and `gml_compile` in turn. If the compile succeeds, everything is
wired up.

To undo whatever it just did:

> Undo the last change.

Every change the server makes is a transaction with a named restore point, so
`gml_undo` reverses a whole operation rather than a single file write.

### 6. Add the live bridge

This is the part that lets the model *see* your game rather than just write to
it. The bridge is a small set of GML resources — one object and two scripts —
that the server installs into your project.

Ask your model:

> Inject the GameMaker bridge, place it in my starting room, then run the game
> and take a screenshot.

Which does this:

```
gml_bridge { action: "inject" }                                   adds obj_gmlmcp_bridge + 2 scripts
gml_add_room_instance { room: "rm_main", object: "obj_gmlmcp_bridge" }   so it starts with the game
gml_run                                                           compiles, launches, connects
gml_screenshot                                                    an image the model can actually look at
```

The bridge must be **in whichever room your game starts in**, or the server has
nothing to connect to. Once it is running, the model can read and write
variables, call functions, count instances, adjust tunables live and take more
screenshots.

When you are done:

> Eject the GameMaker bridge.

Ejecting restores your project to **exactly** the bytes it had before.

### Working with the IDE open

The intended workflow is to keep GameMaker open while the agent works.
GameMaker notices changes on disk and offers to reload.

> **Reload before you save.** If the IDE has been open while the agent added
> resources, saving from a stale in-memory project will drop them. Accept the
> reload prompt first.

---

## What it does

- **Knows the real GML API.** 2,354 functions read from your installed
  runtime's `GmlSpec.xml` — search, signatures, and a checker that flags calls
  to functions that exist nowhere.
- **Edits projects without corrupting them.** A byte-splicing `.yy` document
  model that preserves formatting exactly, validated against 35,917 real files.
- **Every change is a transaction** with a named restore point and unlimited
  undo, backed by a shadow git repo that never touches yours.
- **Creates resources** — objects, scripts, sprites drawn from primitives,
  folders, rooms with cameras, and instances placed in them.
- **Compiles with GameMaker's own toolchain** and reports errors at file and
  line.
- **Talks to the running game** — read and write variables, call functions,
  count instances, adjust tunables live, and take screenshots.
- **Runs deterministic behaviour tests** against that live game.

## See it work

Two complete games, built end to end through the server.

### A platformer

<img src="docs/images/platformer-complete.png" width="49%"> <img src="docs/images/platformer-brick.png" width="49%">

80×12 tiles, 13 sprites, 15 objects, 211 instances. Coins, patrolling enemies
you stomp, pits, bonus blocks, a mushroom that makes you big, bricks only big
Mario can smash, and a flagpole. Coyote time and a jump buffer, because a
platformer that ignores your input feels broken.

An autopilot plays it start to finish over the bridge — **11 coins, 4600
points, reaches the flag** — and eight declarative specs cover the mechanics.

```sh
npx tsx tools/platformer/build.mts --compile   # build it
npx tsx tools/platformer/specs.mts             # 8 behaviour specs
npx tsx tools/platformer/playtest.mts          # autopilot, start to flag
```

### A raycaster

<img src="docs/images/doom-firefight.png" width="49%"> <img src="docs/images/doom-complete.png" width="49%">

32×24 cells, 11 sprites, 15 objects, 292 instances. Textured DDA raycasting at
**683 rays a frame and 120 fps**, with distance shading, sliding doors,
billboarded enemies clipped per column against the wall depths, a hitscan
shotgun, a status bar and an automap.

Walls are real instances, and the collision grid is rebuilt from whatever
instances exist at room start — so rearranging the level in GameMaker's room
editor genuinely changes the level. A bot walks the 41-cell route from spawn to
exit.

```sh
npx tsx tools/doom/build.mts --compile
npx tsx tools/doom/playtest.mts
```

### Every sprite is drawn from primitives

No asset pipeline, no image files in. Rectangles, ellipses, polygons and lines
into a hand-written PNG encoder.

| | |
|---|---|
| ![Platformer sprites](docs/images/platformer-sprites.png) | ![Raycaster sprites](docs/images/doom-sprites.png) |

Levels are ASCII maps, checked before they are built. The raycaster map is
flood-filled from the player start — 504 of 504 floor cells and all 17 entities
reachable — and the platformer asserts that the run-up before every pit is
clear at head height. A level that cannot be finished is worse than one that
looks wrong, and neither check needs the game to run.

## Tools

| Tool | |
|---|---|
| `gml_search` | Find GML functions by name or description |
| `gml_lookup` | Full signature, parameter types and docs for one identifier |
| `gml_check` | Report calls to functions that exist nowhere |
| `gml_compile` | Compile with GameMaker; errors located to file and line |
| `gml_project_info`, `gml_list_resources`, `gml_read`, `gml_list_events` | Read the project |
| `gml_create_object`, `gml_create_script`, `gml_create_folder` | Add resources |
| `gml_create_room` | Create a room, with a scrolling view and a place in the room order |
| `gml_create_sprite` | Build a sprite from shapes, no image file needed |
| `gml_set_event`, `gml_remove_event` | Write gameplay logic |
| `gml_set_sprite_properties`, `gml_rename_resource`, `gml_delete_resource` | Edit and remove |
| `gml_bridge`, `gml_add_room_instance` | Install the in-game bridge and place it |
| `gml_run`, `gml_stop` | Launch the game and connect to it |
| `gml_screenshot` | Capture what the game is showing, as an image to read |
| `gml_live_state`, `gml_live_var`, `gml_live_call`, `gml_tunables` | Inspect and steer the running game |
| `gml_test` | Run deterministic tests against the running game |
| `gml_undo`, `gml_history` | Step back through changes |

## The live bridge

This is what turns a code generator into something that can see what it made.

```
  agent  ──MCP──▶  server  ──TCP 5959──▶  obj_gmlmcp_bridge  (inside your game)
                                                │
                          ping · get_var · set_var · instances · call
                          create · destroy · goto_room · speed · seed
                          input · wait · tunables · screenshot
```

The bridge is **a real GameMaker project** at `bridge/mcp_bridge` — openable,
runnable and debuggable in the IDE, with Feather and breakpoints. Authoring it
as escaped strings inside TypeScript would have made it miserable to iterate
on, and this way the server's own `gml_compile` verifies the one piece of GML
it ships.

**Injection copies the GML, not the `.yy` files.** Resources are re-created
through the normal project API so they adopt your project's own conventions —
copying `.yy` files verbatim would push this project's GameMaker version into
yours. Ejecting restores the project byte for byte.

**The protocol** is newline-delimited JSON over raw TCP, game as server on port
5959. `json_stringify` escapes newlines inside strings, so a bare newline is an
unambiguous frame terminator with no length prefix to keep in sync across
partial reads. The greeting carries a protocol version, so a stale injected
copy is caught on connect rather than mis-parsed.

**GML has no `eval`.** The bridge cannot run arbitrary code sent over the wire,
so every capability is an explicit verb over named assets. Anything genuinely
new needs an edit and a recompile — about three seconds.

**Live tunables are what make tuning practical.** Game code registers values it
wants adjustable, and changing them takes effect immediately. Adjust,
screenshot, look, adjust again, with no recompile in the loop:

```gml
// in your game: read a tunable, falling back to your own default
if (!variable_global_exists("gmlmcp_tunables")) global.gmlmcp_tunables = {};
speed_max = global.gmlmcp_tunables[$ "speed_max"] ?? 8;
```

```
gml_tunables { set: { speed_max: 12 } }
```

Screenshots are deferred to Post Draw, because `screen_save` captures the back
buffer and an async event would catch a partly drawn frame.

## The document model

`.yy` and `.yyp` files are JSON with a dialect of their own: trailing commas,
no space after `:`, marker keys like `$GMObject` and `%Name`, and no trailing
newline. Parse-and-re-serialize loses all of that.

So nothing is ever re-serialized. Edits **splice bytes** into the original
text, leaving every byte outside the edit untouched. Measured across a corpus
of 35,917 real `.yy` files from 131 projects:

| | |
|---|---|
| Byte-splice model | **0** parse failures, **0** splice failures |
| Parse-and-re-serialize | **81.7%** of files come back different |

Key ordering matters too. GameMaker sorts keys case-insensitively, but `_`
sorts *above* every letter — implemented as a `_`→`|` substitution before
comparison. That detail is the difference between 453 ordering violations and
11,570 across 620,224 objects.

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

tx.commit();      // validate -> snapshot -> apply, or roll back
workspace.undo(); // step back, repeatable
```

**Batching is correctness, not tidiness.** Creating one object touches the
`.yy`, the `.yyp` resource list, `.resource_order` and each event `.gml`.
Written one at a time with the IDE open, GameMaker prompts to reload after each
and can reload a half-created resource.

**Validation runs before anything lands.** A `.yy` that does not re-parse is
rejected along with the whole change set, because a corrupt `.yy` stops
GameMaker loading the project at all.

**Undo uses a shadow git repo** at `.gml-mcp/shadow.git`, with the project as
its work tree. Deliberately not your repository — running `git commit` inside
someone's working tree while they have their own staged changes is a bad
surprise. A separate `GIT_DIR` costs nothing, gives unlimited undo depth, and
behaves identically whether or not the project is versioned. `core.autocrlf` is
forced off: 39% of corpus files are CRLF and git would otherwise rewrite them
on restore.

## Rooms

```ts
createRoom(project, tx, 'rm_level1', {
  width: 5120, height: 768,
  background: '#5c94fc',
  view: { width: 1366, height: 768 },
  orderIndex: 0,               // 0 makes it the room the game starts in
});
addRoomInstance(project, tx, 'rm_level1', 'obj_player', { x: 160, y: 640 });
```

A new room gets the two layers GameMaker makes for a blank one: an instance
layer at depth 0 and a background layer at depth 100.

Two prefix conventions live inside a single view object, and they do not mean
the same thing:

| | |
|---|---|
| `wview` / `wport` | **width** — paired with `hview` / `hport` for height |
| `hborder` / `hspeed` | **horizontal** — paired with `vborder` / `vspeed` for vertical |

So `hview` is `768` on a 1366×768 view, while `hborder` is the slack on the
left and right. `test/rooms.test.ts` asserts all four with distinct values.

**Room instance coordinates are floats.** GameMaker writes `"x":384.0` and
`"imageSpeed":1.0`; emitting `384` and `1` would make the IDE rewrite every
instance in the room on its next save.

## Testing game behaviour

Compiling proves the code parses. The checker proves the functions exist.
Neither says whether the game *works*. `gml_test` runs deterministic tests
against the running game:

```json
{
  "name": "holding right moves the player",
  "seed": 424242,
  "speed": 2000,
  "steps": [
    { "set": { "scope": "objPlayer", "name": "x", "value": 100 } },
    { "press": "vk_right" },
    { "wait": 60 },
    { "release": "vk_right" },
    { "expect": { "scope": "objPlayer", "name": "x", "op": ">", "value": 100 } }
  ]
}
```

Tests are declarative rather than code, because an agent talks to this server
over MCP and cannot ship a function across that boundary. Steps cover `seed`,
`speed`, `set`, `press`/`release`, `wait`, `call`, `goto`, `screenshot` and
`expect`; expectations read a variable, call a function, or count instances,
and compare with `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains` or `exists`, with
an optional `tolerance` because physics is rarely exact.

**Determinism** comes from a fixed random seed, input delivered on exact
frames, and waits measured in frames rather than wall clock. **Speed** is the
other half: raising `game_set_speed` runs the simulation faster than real time,
so 120 frames that would take two seconds of play complete in about 130ms.

```
PASS  big Mario smashes a brick with his head  (48 frames, 830ms)
PASS  small Mario only nudges the same brick   (56 frames, 950ms)
PASS  landing on a goomba flattens it          (97 frames, 1634ms)
PASS  a pit is fatal                           (64 frames, 1084ms)
PASS  touching the flag wins the level         (31 frames, 557ms)

8 passed, 0 failed in 9.5s
```

**An input seam is worth building into a game you want an agent to drive.**
Both demos read every control as *the real keyboard OR a global*:

```gml
var _right = keyboard_check(vk_right) || keyboard_check(ord("D")) || global.bot_right;
```

A driver then says exactly what is held, for exactly how long, without racing
whatever else has the keyboard. Jumps go through a one-shot request the game
consumes — `bot_jump_once = 26` means *jump, and hold the button 26 frames* —
so a single round trip describes a whole jump. A human playing notices nothing.

### The limit worth knowing

The tuning loop is fast because live tunables need no recompile. Anything
*structural* — new logic, a changed algorithm — still costs an edit, a
three-second rebuild and a relaunch, because GML cannot evaluate new code in a
running game. No amount of bridge work changes that.

## Compiling and checking

`gml_compile` drives Igor, GameMaker's own build tool, into a dedicated cache
directory so agent builds never contend with IDE builds. Compiler error line
numbers are zero-based; the diagnostics layer adds one so reported lines match
what you see in an editor.

**The compiler and the checker catch different things, and you want both.**
Invented function calls — plausible names, correct-looking arguments — compile
cleanly and exit 0. GameMaker resolves unknown identifiers at runtime, so a
typo becomes a crash when that line is finally reached, not a build error.
`gml_check` reads the same `GmlSpec.xml` Feather uses and flags them before the
build.

It is tuned against the corpus to keep false positives down: 3,126 → 309 across
15,952 `.gml` files, with 49 of 66 projects completely clean.

### Grounding, not preloading

`GmlSpec.xml` is about a megabyte. Loading all 2,354 functions into context
would cost tokens on every request to answer a question the agent has not asked
yet. Instead the server indexes it and answers `gml_search` and `gml_lookup` on
demand, with ranked search and Levenshtein suggestions for near misses. The
spec is read from **your** runtime, so signatures match the version you build
with. It is never redistributed.

## What was measured

Nothing here was assumed where it could be counted.

| | |
|---|---|
| `.yy` corpus | 35,917 files, 131 projects |
| Byte-splice fidelity | 0 failures, versus 81.7% drift for re-serialization |
| Key sort rule | 453 violations versus 11,570, across 620,224 objects |
| Event type table | derived from 4,975 objects, zero ambiguity |
| Checker false positives | 3,126 → 309 across 15,952 `.gml` files |
| GML functions indexed | 2,354 |
| Test suite | 191 passing |

The event-type table came from pairing `eventList` entries against sibling
`.gml` files across every object in the corpus, which produced exactly one
prefix per type with no disagreements:

| | | | |
|---|---|---|---|
| 0 Create | 1 Destroy | 2 Alarm | 3 Step |
| 4 Collision | 5 Keyboard | 6 Mouse | 7 Other |
| 8 Draw | 9 KeyPress | 10 KeyRelease | 12 CleanUp |

Types 11 (Trigger, deprecated), 13 (Gesture) and 14 (PreCreate) never occurred
and are marked unverified in the source. Collision events are named after the
other object — `Collision_objWall.gml` — not a number.

## Development

```sh
npm install
npm test

# Two opt-in suites run against real data:
GML_MCP_CORPUS=/path/to/projects npm test           # format fidelity
GML_MCP_SAMPLE_PROJECT=/path/to/a/project npm test  # resource ops on a real project
```

`test/corpus.test.ts` asserts that every file parses, reproduces byte for byte,
survives a scalar replacement without disturbing another byte, and returns to
its original bytes after an insert/remove round trip.

`test/integration.test.ts` copies a real project and runs the resource
operations over it, checking that a create touches only the expected files and
that undo restores every byte.

The demos double as end-to-end exercises of the whole server:

```sh
npx tsx tools/platformer/build.mts --compile
npx tsx tools/platformer/specs.mts
npx tsx tools/platformer/playtest.mts

npx tsx tools/doom/build.mts --compile
npx tsx tools/doom/playtest.mts
```

`tools/*/preview.mts` renders every sprite to a single sheet, so the art can be
judged without launching anything.

### Layout

```
src/yy/        byte-splicing .yy document model
src/tx/        transactions, shadow-git undo
src/project/   .yyp graph, resources, events, sprites, rooms, symbol index
src/spec/      GmlSpec.xml knowledge base, runtime discovery
src/build/     Igor driver and diagnostics
src/bridge/    injection and the TCP client
src/testing/   deterministic test runner
src/image/     PNG encoder and rasteriser
src/mcp/       the MCP server itself
bridge/        the injectable GameMaker project
tools/         demos, corpus measurement scripts
```

## Prior art and attribution

Nothing here vendors or depends on third-party source. The runtime dependencies
are the MCP SDK and Zod; everything else — the `.yy` parser, the PNG encoder,
the rasteriser, the raycaster — is written for this project.

**[Stitch](https://github.com/bscotch/stitch)** by Butterscotch Shenanigans
(MIT, © 2023) — `@bscotch/yy` for project files, plus a GML parser and VS Code
extension. Read as a reference, deliberately not a dependency: its model
re-serializes `.yy` files where this one splices bytes. Its version-gate table
is a useful record of GameMaker's schema drift. No Stitch code is reproduced
here.

**Raycasting technique** — the demo in `tools/doom/` uses the grid traversal
from Amanatides & Woo, *A Fast Voxel Traversal Algorithm for Ray Tracing*
(1987), applied to a first-person view the way Wolfenstein 3D did and as set
out in [Lode Vandevenne's raycasting
tutorial](https://lodev.org/cgtutor/raycasting.html). That tutorial's source is
*"Copyright (c) 2004-2020 by Lode Vandevenne. All rights reserved."* with no
licence grant, so none of it is copied: the GML is written from the published
technique. The credit is owed regardless.

**GameMaker's `GmlSpec.xml`** is read from your own runtime install at runtime.
It is not redistributed and no copy is checked in.

**The demo games** are original code and original art — every sprite is drawn
from primitives by `tools/*/art.ts`, with no imported asset. They are
*pastiches*: a platformer in the style of Super Mario Bros. and a shooter in
the style of Doom. Nintendo and id Software own those properties; this project
is not affiliated with or endorsed by either.

GameMaker is a trademark of YoYo Games. This is an independent project.

## Licence

[MIT](LICENSE) — use it, fork it, ship it.
