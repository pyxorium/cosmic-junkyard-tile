# Project: RPG Actor Sprite Web Tile (dice-dodge game + live sprite loading)

Reference doc for a new chat. Sections 1 to 9 capture the original
discussion-only exploration of converting the existing p5.js game into a
Web Tile, and how to load a player's own atproto RPG actor sprite into it
despite the sandbox's constraints. **Section 0 records the decisions made on
October 2, 2026, which settle most of the open questions in section 8.**
Where section 0 and a later section disagree, section 0 wins.

---

## 0. Decisions and findings (October 2, 2026)

### Settled decisions

- **Rendering: plain Canvas 2D, no p5.js, no WebGL.** p5 turned out to be
  far larger than the "few hundred KB" estimated in section 2: measured
  inside the House Dice app bundle, it takes roughly 1.4MB minified (about
  375KB gzipped; slice boundaries approximate). A tile bundles the raw
  file, so the raw size is what counts. The game only uses a small slice
  of p5 (rectangles, circles, text, image slicing, rotation, keys, touch,
  a timer), all of which map almost one to one onto the browser's built in
  Canvas 2D API (`fillRect`/`roundRect`, `arc`, `fillText`, the same
  9-argument `drawImage`, `save`/`rotate`/`restore`,
  `requestAnimationFrame`, key and pointer listeners). This keeps the tile
  zero dependency like every other tile. WebGL was considered and set
  aside: workable, but it has no text drawing at all (score, buttons and
  the saucer/alien emoji would all need pre-rendered textures) and gives
  no visible benefit for a flat 2D game.
- **Free play only, no share button.** A tile can't write to a PDS, so
  there's no saved daily record or streak. A finished run shows the score
  and a Play Again button. (Clipboard access inside a sandboxed iframe was
  also uncertain, which this sidesteps.)
- **Fallback sprite: the `thunderbirdwine` sprite, bundled.** The live app
  fetches it at runtime from `did:plc:joer5rzmwgec3dkr4srfmq45`; in the
  tile it ships as a bundled image resource so the game is playable the
  instant it loads.
- **Handle search: keep the typeahead (`typeahead.waow.tech`).** The tile
  goes on a **public page**, so the blog post gets a line similar to:
  "Handle search powered by typeahead.waow.tech." (The host page sends
  each typed keystroke to that community-run service.)
- **Host component needed.** Even though this is a single tile, the search
  UI and the sprite fetch run in the host page, so the demo needs its own
  host component in `src/components/`, following the pair pattern
  (`WishDemo.astro`, `DieDemo.astro`) rather than a bare `<WebTile />`.
- **Face-forward-at-rest behavior carries over.** On October 2 the live
  game was changed so the sprite faces the player (sheet row 0) when
  standing still, with a 175ms grace period during play so quick taps
  don't flicker, and faces forward on the start and results screens. The
  tile port should keep this.

### Build status (October 2, 2026)

Local folder: `C:\thunderbird-cafe\cosmic-junkyard-tile`

```
tile\        index.html, manifest.json, sprite.png   (the published tile)
host-demo\   CosmicJunkyardDemo.astro, test-harness.html,
             lib\sprite-host.js, lib\sprite-host.css
```

- **Tile built, tested and PUBLISHED** under thunderbird.cafe on
  October 2, 2026:
  `at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3mwvoqidyqd24`
  (record CID `bafyreidm4jujsibeaf4xyxjdmkb6ni3sislbhlwrsgwk6ap2zovu4gzed4`).
  Resources: `/` = index.html (`bafkreigy6f5ua2hobes4zyurdpdd45jcd47ldv444hfkortdvbpjtwpwk4`),
  `/sprite.png` (`bafkreidtr5uxobcoz6uxnjjmvtdmnwdt462624wbzxne6tvqxzdquv7xsy`).
  Published with `cosmic-junkyard-tile\upload_tile_blobs.py` (asks for the
  app password on screen) then the shared
  `wish-demo\publish\publish_tile.py`.
- **Host built and tested with mocked network calls**, both Blob and
  data-URL formats: typeahead, pick, load, tile reload re-send, no-sprite,
  broken image, unknown handle, cancel.
- Shared host logic lives in `sprite-host.js` so the blog post and the
  local harness run identical code. In the site repo it goes to
  `src/lib/cosmic-junkyard/` (with the CSS), and the component to
  `src/components/CosmicJunkyardDemo.astro`. Post usage:
  `<CosmicJunkyardDemo uri="at://.../ing.dasl.masl/<rkey>" />`, with
  `imageFormat="dataurl"` as the no-republish fallback if Blobs don't
  survive the loader.
- Local test: from `cosmic-junkyard-tile`, `python -m http.server 8000`,
  open `http://localhost:8000/host-demo/test-harness.html` (add
  `?format=dataurl` to test the fallback). Uses real network lookups.
- **Real loader pipeline tested, October 2, 2026** (local `npm run dev`,
  draft post): the tile loads, the button appears, and a sprite sent as a
  real **Blob survives the loader's frames**. Default `imageFormat="blob"`
  works; the data-URL fallback wasn't needed.
- Preview picture added with `add_tile_screenshot.py`
  (`tile-screenshots\cosmic-junkyard.png`, 775x387); tile kept its address.
- One demo per page; don't share a page with WishDemo or DieDemo (each
  makes its own tile loader).

### Shipped (October 2, 2026)

- Blog post live: `thunderbird.cafe/blog/cosmic-junkyard-tile`
  ("Cosmic Junkyard: A Web Tile That Lets You Play Your Sprite"), commit
  `7f1b0c3`. Site files: `src/components/CosmicJunkyardDemo.astro`,
  `src/lib/cosmic-junkyard/sprite-host.js` + `.css`,
  `src/assets/cosmic-junkyard-cover.png`.
- Sequoia: `site.standard.document/3mwvrzywwxc2d`, Bluesky post
  `app.bsky.feed.post/3mwvrzz2xv42r`. Dry run showed only the new post
  (`+`, `[bsky: will post]`). Cleanup patch applied and verified: text
  starts cleanly, no `import` or component tag. Bookkeeping committed
  (`df5a77f`).
- Live site tested: game plays, own sprite loads through the real loader.
- Lesson for the workflow doc: when setting `BSKY_APP_PASSWORD` with the
  `Read-Host` prompt, paste the command unchanged and type the password
  only at the `App password:` prompt it shows. The
  `[System.Net.NetworkCredential]::new('', $p).Password` form worked
  reliably; the `PtrToStringAuto` form did not on this machine.

### Answers to the section 8 open questions

| Open question (section 8) | Answer |
|---|---|
| Is the sprite a flat image or procedural? | **Flat sprite sheet image.** An `actor.rpg.sprite` record with a `spriteSheet` blob plus `frameWidth`, `frameHeight`, `width`, `height`. The game slices frames out of it. Placeholder is therefore a static bundled sheet. |
| Does a working actor search API exist? | **Yes, already in use.** House Dice's `HandleTypeahead` calls `typeahead.waow.tech` (`tech.waow.typeahead.searchActors`). |
| How does the host resolve the sprite? | **Already built in House Dice (`fetchSprite` in `main.jsx`), reusable.** Handle to DID via `com.atproto.identity.resolveHandle` (bsky.social), DID to PDS via `plc.directory`, then `com.atproto.repo.getRecord` for `actor.rpg.sprite` / rkey `self`, then `com.atproto.sync.getBlob` for the image. Four hops, not two, but none of it is new ground. |
| Host to tile payload shape | Not just the image. The tile needs the Blob **plus** `frameWidth`, `frameHeight`, `sheetWidth`, `sheetHeight` to cut frames and pick facing rows (including row 0 for face forward). **Settled: see "Message shapes" below.** |
| Blob first, or base64 fallback first? | Still open; Blob first remains the recommendation. |
| Bundle p5? | **No longer applies:** no p5 (see above). |
| Cache the sprite across reloads? | Still out of scope. |
| Which account publishes the tile? | **`thunderbird.cafe`.** |

- **Publishes under `thunderbird.cafe`.**
- **Search box placement: inline**, just below the tile on the host page,
  revealed when the tile asks for it. Keeps "the host page does the
  search, not the tile" visible to readers.

### Transport (same path as the wish demo)

The tile imports `/.well-known/web-tiles/data.js` (provided by the
loader), sends with `sendData(payload)` and receives with
`addDataHandler(fn)` + `listen()`. The host listens for
`tiles-protocol-up-data-payload` window messages, identifies the tile by
`event.source === iframe.contentWindow`, and replies by posting
`{ action: "tiles-protocol-down-data-payload", payload }` into that
iframe. See `WishDemo.astro` and `wish-protocol.md` ("Transport tiers").
The tile keeps the same three tiers as Bob's tile: real pipeline, plain
iframe (`window.parent.postMessage`), standalone (plays with the bundled
fallback sprite).

### Message shapes (agreed October 2, 2026)

Every message carries a `kind` field (the die demo's convention, not the
wish demo's mix of `action`/`type`). Wish vocabulary (`makeWish`,
`supply`) is deliberately not used: this is a host-native capability,
not a wish (section 4).

Tile to host:

```js
{ kind: "hello", v: 1 }        // tile started; host re-sends any sprite it already loaded
{ kind: "sprite-request" }     // player tapped "Load my RPG actor sprite"; host reveals + focuses the inline search
```

Host to tile:

```js
{ kind: "sprite-status", state: "ready" | "searching" | "loading" | "no-sprite" | "error" | "cancelled" }

{
  kind: "sprite", v: 1,
  handle: "someone.bsky.social",
  image: Blob,                  // or a "data:image/png;base64,..." string
  frameWidth: 48, frameHeight: 48,
  sheetWidth: 144, sheetHeight: 192
}
```

Rules:

- **The tile accepts either a Blob or a data-URL string for `image`.** The
  tile's code is sealed at publish; the host isn't. If a Blob doesn't
  survive the loader's frames, switching to data URLs is a host-only
  change, no tile republish. (Confirmed October 2: Blobs pass through the
  real loader cleanly.)
- **The host answers every `hello` with `sprite-status` / `ready`** (or with
  the sprite itself, if one is already loaded). The tile only shows its
  "Load my RPG actor sprite" button once a host has answered, so embedded
  somewhere that doesn't run the search (the gallery, a plain
  `<WebTile />`, webtil.es) the button stays hidden instead of doing
  nothing. (Added while building the tile.)
- `v: 1` lets the host evolve the format without breaking a published
  tile.
- The tile validates: dimensions are positive whole numbers within a sane
  limit, the image actually loads; otherwise it keeps the fallback.
- The host validates before sending: the blob is an image and under a
  size cap (around 1MB).
- No reset message for now; `{ kind: "sprite-clear" }` could be added
  later for "back to the default character".

### Fallback sprite details

`thunderbirdwine.bsky.social` (`did:plc:joer5rzmwgec3dkr4srfmq45`, PDS
`https://brittlegill.us-west.host.bsky.network`). Its `actor.rpg.sprite`
record: 144x192 PNG, 48x48 frames, 3 columns x 4 rows, blob CID
`bafkreidtr5uxobcoz6uxnjjmvtdmnwdt462624wbzxne6tvqxzdquv7xsy` (12,297
bytes). Bundled into the tile as `sprite.png`. Row 0 faces the viewer,
row 1 left, row 2 right.

### Still open

- **Decided:** the tile seeds its daily drop sequence from the
  America/Denver date, House Dice's day boundary, so the tile and the app
  serve the same run on the same day. (The live House Dice room still uses
  the browser's local date; worth aligning there separately.)
- Saucers and aliens are drawn as emoji, so they look slightly different
  per platform. Fine, just expected.

---

## 1. The existing game, as described

A p5.js game already built and working: dice fall from the sky, the
player moves an RPG actor sprite left/right to dodge them, scored with
points (dodged dice add their value, hits subtract it, saucers and aliens
are bonus pickups). Working name: "Cosmic Junkyard" (the user's own
project, part of House Dice's Dice Lab).

The feature of interest: the sprite is meant to represent **whoever's
atproto account is in play**, not a fixed character.

---

## 2. Porting to a Web Tile: what's straightforward, what isn't

**Straightforward**: the core gameplay (falling dice physics, movement
input, collision/dodge logic, scoring) is pure procedural logic,
directly portable, same category of work as this project's existing
Pong tile.

**A real cost: p5.js itself.** *(Superseded by section 0: p5 is being
dropped in favor of plain Canvas 2D.)* Every tile built in this project so
far uses raw WebGL/Canvas with zero external libraries, specifically
because the Web Tile CSP forbids loading scripts from a CDN at runtime.
p5.js would need to be bundled as an actual resource inside the tile
package. The original estimate here ("a few hundred KB even minified")
turned out to be low; see section 0.

**The actual hard part: "whoever's logged in."** A normal web app can
check who's logged in and fetch their specific data live, the moment
someone plays. A Web Tile categorically cannot: no network access after
load. This constraint, and how to work around it honestly, is what the
rest of this document is about.

---

## 3. The sprite-loading UX, as refined through discussion

### Rejected/superseded framing: automatic "logged in" detection
Initially discussed as "load whoever's logged into the app", but a tile
has no session/login relationship with anything; there's no "currently
logged in user" concept available to it at all.

### Adopted framing: explicit search-and-confirm
1. Client tile shows a button: "Load my RPG actor sprite."
2. Clicking it triggers a search/confirm experience where the player
   types their own atproto handle, sees type-ahead matches, and
   confirms which account is theirs.
3. Once confirmed, the actual sprite image is fetched and rendered
   into the tile.

This is a **deliberate, different trust model** from "automatically
known from login": it requires no session relationship between the host
and the viewer at all, which is more robust, not less.

---

## 4. Key clarification: this is NOT a "wish", and why that matters

- **The CSP restriction (no live network) applies uniformly to every
  tile, client or service.** No tile, in any role, can implement a live
  type-ahead search.
- Therefore this interaction isn't "two tiles cooperating through a host
  that's just relaying messages" (which is what a wish is); it's **the
  host doing the entire job itself**, because it's the only party that
  can. No second tile is involved.
- **Vocabulary**: alongside **wishes** (tile-to-tile cooperation, host as
  pure relay), there's a separate category, **host-native capabilities**:
  things only the host can do (live search, live network lookups), which
  a tile can trigger and receive results from, but which don't involve
  another tile. Keep these distinct; they carry different trust models
  and implementation shapes.
- Rejected alternative: forcing a "service tile" into the loop by
  relaying every keystroke back to the host for lookup. Possible, but
  trades a clean one-shot interaction for a constantly chattering one,
  for no real benefit.

---

## 5. The actual mechanism: how the sprite gets from the network into the tile

1. Tile button click: message to host (a lightweight trigger).
2. Host renders the search/confirm UI itself (outside the tile's sandbox).
3. Player types, sees matches, confirms their account.
4. **Host resolves the sprite** (see section 0 for the confirmed
   four-hop chain, already implemented as `fetchSprite` in House Dice).
5. **`postMessage` carries the image data across the sandbox boundary as
   a real `Blob`**: structured clone handles this natively. Per section
   0, the message must also carry the sheet's frame and sheet dimensions.
6. Tile receives the Blob, calls `URL.createObjectURL(blob)`, and uses
   the resulting `blob:` URL as the sprite sheet image.
7. Every tile's CSP in this project already allows both `blob:` and
   `data:` sources; nothing new needs adding.
8. **Fallback, if Blob-via-postMessage proves fussy**: send a base64 data
   URL string instead. Heavier, simpler, covered by the same `data:`
   allowance. Try the Blob approach first.

---

## 6. What does and doesn't touch the published tile record

None of the sprite-loading mechanism touches the tile's manifest or
published record. The manifest's `resources` map, baked in at publish
time, stays static and sealed.

- The Blob lives **purely in browser runtime memory** for that page
  session. It is never written back into the tile's record.
- **Consequence**: the sprite is gone on page reload; the flow would need
  to run again unless caching is built later (not planned).
- **Principle**: a tile's *code* is sealed at publish time, but the
  *data* that code operates on can be fully dynamic, supplied fresh every
  load.

---

## 7. The placeholder/fallback sprite requirement

The tile needs something sensible to render the instant it loads, before
any interaction happens, so the game is fully playable immediately and
"load my real sprite" is an enhancement, not a requirement.

**Resolved (section 0):** the real sprite is a flat sprite sheet image, so
the placeholder is a static bundled image: the `thunderbirdwine` sprite
sheet.

---

## 8. Open decisions for the new chat (original list)

*See section 0 for current status; most of these are now answered.*

- Confirm whether the existing p5.js sprite rendering is a flat image
  or something procedural. **Answered: flat sprite sheet.**
- Verify a working atproto actor/handle search API exists. **Answered:
  `typeahead.waow.tech`, already in use.**
- Decide the exact shape of the "button click to host" trigger message,
  and the host to tile Blob-delivery message. **Settled (section 0).**
- Blob-via-postMessage first, or base64 data-URL first. **Still open;
  Blob first recommended.**
- Whether/how to bundle p5.js. **No longer applies: Canvas 2D.**
- Caching a confirmed sprite across reloads. **Still out of scope.**
- Which account this tile gets published under. **`thunderbird.cafe`.**

---

## 9. Relevant context from the broader wishes/intents exploration

This project is a concrete application of ideas developed in a parallel,
more general exploration (see `web-tile-wishes-intents-project.md`, if
available), including the W3C Web Intents spec and Robin Berjon's original
"Web Tiles" post (the source of the "wishes" manifest schema and
`window.makeWish()` API). This RPG-sprite case is where the
**"host-native capability" vs. "wish"** distinction (section 4) was first
identified; worth feeding back into the general wishes document.
