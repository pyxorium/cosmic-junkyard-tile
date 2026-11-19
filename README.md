# Cosmic Junkyard: a sealed web tile game that saves runs to the player's own account

Cosmic Junkyard is a small arcade game published as a [web tile](https://tangled.org/robin.berjon.com/dasl-tiles):
dodge the falling dice, catch the saucers and aliens. It lives at one atproto address,

```
at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3mwvoqidyqd24
```

and you can play it in [Raku](https://raku.lexicographer.space/#t=at%3A%2F%2Fdid%3Aplc%3A6vxjigxrqizmbo56gojxico3%2Fing.dasl.masl%2F3mwvoqidyqd24&a=0),
a browser for web tiles.

This repo is also a demo for game developers. A tile is sealed: it can't reach the network, can't see who is signed
in, and can't write anywhere. Cosmic Junkyard still does three things a game usually needs a server for:

1. **It plays as the player's own character.** It asks its host page, and the host hands over the signed-in player's
   [rpg.actor](https://rpg.actor) sprite.
2. **It saves a finished run to the player's own account.** It asks the host, the host asks the player, and the host
   writes the record. The game never gets the player's sign-in.
3. **It can offer checkable runs.** If the player chooses, a saved run includes the moves, and anyone can replay them
   to check the score (`scripts/check-run.mjs`).

Everything here is plain files with no packages: the game is one `index.html`, and the scripts need only Node 22.

## How a tile game talks to its host

The game and its host exchange small JSON messages over the tiles spec's data channel: the tile imports
`/.well-known/web-tiles/data.js` (served by the tile loader), sends with `sendData(payload)` and receives with
`addDataHandler(fn)` and `listen()`. The host sees each message as a `tiles-protocol-up-data-payload` window message
from the tile's frame, and answers with `{ action: "tiles-protocol-down-data-payload", payload }`. (Loaded in a plain
iframe instead, the game uses `window.parent.postMessage`; with no host at all, it just plays.)

Every message has a `kind`. A host only has to answer the ones it supports. The game shows a feature only after the host
has said it supports it, so on a page that answers nothing (a gallery, a plain embed) its buttons stay hidden instead
of doing nothing.

### The character (since version 1)

| Direction | Message | When |
|---|---|---|
| game → host | `{ kind: "hello", v: 1 }` | the game has loaded |
| host → game | `{ kind: "sprite-status", state }` | `ready` (the answer to hello: shows the game's "Load my RPG actor sprite" button), `searching`, `loading`, `no-sprite`, `error`, `cancelled` |
| host → game | `{ kind: "sprite", image, frameWidth, frameHeight, sheetWidth, sheetHeight, handle }` | at any time; `image` is a PNG Blob or a `data:image/…` string; the bar then says "Playing as @handle" |
| game → host | `{ kind: "sprite-request" }` | the player pressed the sprite button |

A sprite that arrives during a run is shown from the end of that run, so each run is played with one character from
start to finish.

### Saving a run (since version 2)

| Direction | Message | When |
|---|---|---|
| host → game | `{ kind: "can-save", collections: ["cafe.thunderbird.cosmicjunkyard.run"] }` | answering hello, only from a host that can save this game's runs: the end screen then offers **Save this run** |
| game → host | `{ kind: "write-record", id: "run-1", action: "create", collection: "cafe.thunderbird.cosmicjunkyard.run", record: { … } }` | the player pressed Save this run |
| host → game | `{ kind: "write-record-status", id, state: "asking" \| "saving" }` | while the host works on it |
| host → game | `{ kind: "write-record-result", id, ok: true, uri: "at://…", handle: "…" }` | saved: the game says "Saved to @handle's account ✓", with **See it** |
| host → game | `{ kind: "write-record-result", id, ok: false, error }` | not saved: `declined` (the player said no), `not-allowed` (this host won't save for this tile), `invalid` (the record didn't pass the host's check), `failed` (try again) |
| game → host | `{ kind: "open-record", uri }` | the player pressed See it |

`write-record` is shaped like the `writeRecord({ repo, action, collection, rkey, record })` call in sōm's draft "Tiles
Protocol: ATProto Records", so a host could offer the same request to other games for their own collections. The `id`
is the game's own name for the request; every answer carries it back.

**What the game sends in `record`** is only what it knows: `score`, `day`, `playedAt`, `tally`, and `moves` when the
player ticked "Include my moves so this run can be checked" (unticked by default). **The host adds the rest:** `$type`,
`createdAt`, and `game`, the address and exact version of the tile that actually ran, taken from what the host itself
loaded, never from the game. That last part is what makes a checked run mean something: the record says truthfully
which version of the game produced it.

## The record: `cafe.thunderbird.cosmicjunkyard.run`

`lexicons/cafe.thunderbird.cosmicjunkyard.run.json`, published from thunderbird.cafe. A run is saved in the player's
own repo, one record per saved run, keyed by a TID (time-based, like a Bluesky post).

| Field | | |
|---|---|---|
| `game` | required | the game tile that played the run, as a strongRef: its `ing.dasl.masl` record's address and exact version (`uri`, `cid`) |
| `score` | required | the final score: dice dodged add their value, dice hit take it away, saucers add 10, aliens 15 |
| `day` | required | the day's course that was played, `YYYY-MM-DD` (the America/Denver calendar day; everyone gets the same course that day) |
| `playedAt` | required | when the run ended, by the player's clock |
| `createdAt` | required | when it was saved |
| `tally` | optional | what the end screen shows: `dodged`, `hit`, `saucers`, `aliens` |
| `moves` | optional | only if the player chose to include them: `frame` (the character's frame size, which sets its hitbox), `steps` (how many 60 Hz steps the run took) and `changes` (each change of direction: `{ at: step, go: "left" \| "right" \| "stop" }`, at most 4,000) |

An example, with moves:

```json
{
  "$type": "cafe.thunderbird.cosmicjunkyard.run",
  "game": { "uri": "at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3mwvoqidyqd24", "cid": "bafyrei…" },
  "score": 172,
  "day": "2026-11-19",
  "playedAt": "2026-11-19T18:04:51.201Z",
  "tally": { "dodged": 27, "hit": 8, "saucers": 6, "aliens": 3 },
  "moves": {
    "frame": { "width": 48, "height": 48 },
    "steps": 2601,
    "changes": [{ "at": 12, "go": "left" }, { "at": 40, "go": "right" }, { "at": 94, "go": "stop" }]
  },
  "createdAt": "2026-11-19T18:04:58.630Z"
}
```

**About the moves and privacy.** They're step numbers at 60 a second, not millisecond keystrokes, but they are still
a pattern of play, public on the player's account and kept. That's why they're opt-in, every time. Any saved run, with
or without moves, shows that the player played, their score and roughly when (a TID key encodes its own time).

Lexicons only grow: new fields will be optional, and existing ones keep their meaning. This is a narrow lexicon for one
game; a shared one for many games can come once several games show what they have in common.

## Checking a run

```
node scripts/check-run.mjs run.json [tile/index.html]
```

`run.json` is a saved run (the record's value, or `getRecord`'s whole answer) that has its moves. The script takes the
**RUN ENGINE** block out of the game's `index.html`, the part that decides a score and never touches the page, and
replays the moves through it on that day's course, with that frame size, one step at a time. It then says whether the
score (and the tally) match.

Use the version of the game the record names (`game.cid`). `published.json` lists each version's record CID with the
files it was made from, and this repo's history has each version's `index.html`.

A passing check shows that those moves, on that day's course, in that version of the game, give that score. That
catches an invented score, a different day, and an altered game. It can't show that a person played them, rather than
a program. Nothing checks runs automatically yet.

## What Raku does (one host's rules)

[Raku](https://github.com/pyxorium/raku) is the first host that saves runs. Its rules, as an example for other hosts:

- **Only this game's own tile, only into its own collection.** Raku keeps a list of games that may save: each one's
  address (any version of it) and collection. A copy of the game published somewhere else isn't told it can save, and
  its `write-record` is refused (`not-allowed`). A copy would need its own collection.
- **Only the game's own fields.** Raku takes `score`, `day`, `playedAt`, `tally` and `moves` and nothing else, fills in
  `game` from the tile it is actually running, and checks the whole record exactly against the lexicon (a copy of
  `scripts/run-record.mjs`). Anything else is `invalid`, before the player is asked. A `playedAt` more than a day old,
  or in the future, is refused too.
- **Raku asks, outside the tile,** so a game can't fake or skip the question. It shows what will be saved and offers
  Allow once, Always (for that account and that game, in that browser) or No. Signed out, it signs the player in first.
- **"See it"** opens only the record Raku has just written for that tile, with Raku's usual "Open in" choices.
- Raku's sign-in permission set (`cafe.thunderbird.authRaku`) lists this collection by name. So each new game that saves
  means a new entry in that set, and signed-in players approve it once more.

## Doing the same in another game

1. **Give your game its own lexicon and collection,** under a domain you control (here, `cafe.thunderbird.cosmicjunkyard.run`,
   with the DNS TXT record `_lexicon.cosmicjunkyard.thunderbird.cafe` pointing at the publishing account). Keep it small
   and exact. `scripts/publish-lexicons.mjs` is a no-packages publish script you can copy.
2. **Say hello, and wait for `can-save`** before showing a save button.
3. **Send `write-record`** with only the fields your game knows; let the host fill in which game and version it is.
4. **If you want checkable runs,** keep the rules in one block that never touches the page and has no clock or
   randomness of its own (seed anything random from the day, step at a fixed rate, record inputs by step), and make
   including the moves the player's choice.
5. **Ask hosts to add your game:** a host needs your tile's address, your collection, and a check of your record.

## Files

| | |
|---|---|
| `tile/index.html`, `tile/sprite.png` | the game itself, as published (`sprite.png`: the character used until the host sends one); `tile/manifest.json`: its name, description and size |
| `lexicons/` | `cafe.thunderbird.cosmicjunkyard.run`, a saved run |
| `scripts/check-run.mjs` | replays a saved run's moves and checks its score |
| `scripts/run-record.mjs` | for hosts: the exact check of a run record, and how to make one from the game's `write-record` |
| `scripts/publish-lexicons.mjs` | publishes the lexicon from thunderbird.cafe (`--dry-run` first) |
| `scripts/revise-tile.mjs` | publishes `tile/` over the game's own record, keeping its address (`--dry-run` first) |
| `scripts/lib/` | the CID helpers, copied from the Web Tile Foundry |
| `published.json` | what has been published: the lexicon, and each version of the tile (its record CID and files) |
| `tools/sound-tuning.html` | play and adjust the game's beeps (open it in a browser); its "Copy settings" gives the text for `SOUND_SETTINGS` in the game |
| `test/` | `npm test` (Node): version 2 plays exactly as version 1, replays, the lexicon, the record check, the scripts against stand-in servers; `test/browser/` (Playwright with Chromium): the game in a plain-iframe host, the tuning page |
| `host-demo/` | the game's first host: the search box and sprite fetch used by the [blog post](https://thunderbird.cafe/blog/cosmic-junkyard-tile) |
| `upload_tile_blobs.py`, `record.prepared.json`, `upload_results.json` | how version 1 was first published (Oct 2 2026) |
| `rpg-sprite-wish-demo-project.md` | the notes from building version 1: why the host does the search, the sprite message shapes |

## Versions

- **Version 1** (Oct 2 2026): the game, and the player's character from the host.
- **Version 2** (Nov 2026): sounds (Web Audio beeps, no sound files, a mute button in the bar), saving runs through the
  host, optional moves for checking. Gameplay is unchanged: `test/v1-v2.mjs` runs version 1's own code and version 2's
  run engine side by side, step by step, and they agree. The four character messages are unchanged too, so every page
  that showed version 1 shows version 2 the same way.
