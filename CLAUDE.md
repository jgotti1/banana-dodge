# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Banana Dodge

A Frogger-style browser game: a monkey crosses jungle lanes of thrown
bananas and rolling barrels, dodging poop the three gorillas randomly
drop, to reach one of four gaps between those gorillas at the top of
the board. Live at https://banana-dodge.vercel.app.

## Running the game

No build step and no dependencies. Just open `index.html` in a
browser:

```
open index.html
```

To test on a phone over the local network (or if you hit any
`file://` restrictions), serve the directory instead:

```
python3 -m http.server 8000
```

There is no package.json, linter, or test suite in this repo. Check JS
syntax with `node --check banana-dodge.js`. For gameplay logic, a Node
`vm` run of `banana-dodge.js` against a stub DOM works well (fake
`getElementById`/`querySelector`, a capturing `requestAnimationFrame`
you step manually with a fake `performance.now`, a Proxy canvas context
that records `fillText`, and click the stub `#startBtn` to begin). It
can't show visual bugs, so still open the page for anything rendered.

## Deploying

- GitHub: `jgotti1/banana-dodge`, branch `main`.
- Vercel project `banana-dodge` (team `john-74e3`), static site with no
  build settings. This folder is linked (`.vercel/`), so deploy with
  `vercel --prod` (Vercel CLI is installed machine-wide via Homebrew).
- Pushes to `main` may not auto-deploy (the GitHub link wasn't verified
  when the project was created), so run `vercel --prod` after pushing.
- `vercel link` wrote `.env.local` containing a Vercel OIDC token;
  `.gitignore` excludes it and `.vercel/`. Never commit either.

## Current state

The game lives in three files:

- `index.html` — a normal HTML5 document skeleton (`<!DOCTYPE html>`,
  `<head>` with charset/viewport meta, a `<link>` to the stylesheet) plus
  the body markup: the HUD, the `<canvas id="game">`, the on-screen d-pad,
  three full-screen overlays (`#startOverlay`, `#introOverlay`,
  `#gameOverOverlay`), the non-blocking `#levelClearOverlay` toast, and
  the click-through `<canvas id="confetti">`.
- `banana-dodge.css` — all styling (jungle color theme, HUD layout,
  d-pad grid, overlay screens, monkey-animation keyframes).
- `banana-dodge.js` — all game logic, wrapped in a single IIFE.

Rendering is plain Canvas 2D, driven by a vanilla JS game loop
(`requestAnimationFrame`). No frameworks, no libraries, no build tooling.

## How the game works

- **Grid**: 7 columns x 9 rows, defined in `laneDefs`. Row 0 is the
  goal row (top), row 8 is the start row (bottom).
- **Lane types**: `goal`, `start`, `safe` (median strips), `banana`
  (bananas fly horizontally), `barrel` (barrels roll horizontally).
  Each hazard lane has a direction, base speed, hazard count, and
  hazard radius.
- **Goal row**: gorillas sit at columns 1, 3, 5 (`GORILLA_COLS`) and
  block movement into that cell. Gaps are columns 0, 2, 4, 6
  (`GAP_COLS`); landing on an unfilled gap scores 50 and marks it
  filled (an already-filled gap also blocks movement, same as a
  gorilla). Filling all 4 gaps clears the level.
- **Movement**: `tryMove(dir)` handles one grid-cell hop, with a
  short animation tween (`monkey.animT` over `ANIM_DURATION`) and a
  `moveLock` to block input spam mid-hop. `finishMove()` commits the
  new grid position once the tween completes and handles gap-arrival
  logic.
- **Hazards**: the `hazards` array holds live objects with `x`
  position (in column units, not pixels), `speed`, `dir`, updated
  each frame in `updateHazards()`, wrapping around at the grid edges.
  `speed` is in **sprite widths per second**, converted to columns each
  frame (`* SPRITE / CELL_W`), and `spawnHazards()` scales each lane's
  hazard count by `CELL_W / SPRITE`. Together these keep on-screen speed
  and hazard spacing identical to the original square-cell game when
  the board is stretched wide. Don't switch speed back to columns/sec:
  that made hazards 2–3× faster on iPad landscape and desktop.
- **Gorilla poop**: `updateGorillas()` (called from `updateHazards()`)
  counts down `nextDropIn` (random 2.5–6s), then picks a random
  non-shaking gorilla and sets `gorillaShake[col]` to 0.7s as a
  telegraph: the gorilla chest-beats (see Gorilla sprites) while
  `sfxGorillaRoar()` and `sfxChestBeat()` play. When the
  shake ends it pushes a `type: 'poop'` object into the regular
  `hazards` array. Poop moves **vertically**: `x` is its column, `y` its
  row-center position, `speed` in rows/sec (scaled by `speedMul()`).
  It's removed at `POOP_LAND_Y` (top edge of the start row), so the
  start row is always safe; the monkey respawns at col 3, directly
  under the middle gorilla, so this matters. `spawnHazards()` clears
  poop and resets the shake/drop timers each run/level. Code that
  loops over `hazards` must branch on `type === 'poop'` because poop
  has no `row`/`dir`.
- **Boss gorilla**: a bigger party-hat gorilla modeled on the owner's
  Gorilla Tag plush reference (rounded black body, grey ears/face/chest,
  big black-rimmed white eyes, long arms stretched out, rainbow zig-zag
  party hat, a 💩 held in his left hand). He lives in a canopy band
  `BOSS_BAND_ROWS` row-heights tall above row 0, sitting on a branch.
  `updateBoss()` (called from `updateHazards()`) walks him between
  `BOSS_MIN_X` and `BOSS_MAX_X` at `BOSS_SPEED` sprite widths/sec,
  turning at the ends; every `BOSS_THROW_MIN`–`BOSS_THROW_MAX` seconds
  he stops for `BOSS_WINDUP` (lifting the poop overhead, `sfxOohOoh()`),
  then pushes a normal `type: 'poop'` hazard from his raised hand
  (`BOSS_HAND_UP`) with `sfxBossThrow()`, and is empty-handed for
  `BOSS_RELOAD`. Boss poop starts at negative `y` (up in the band) and
  otherwise behaves exactly like gorilla poop. `bossSize()`,
  `bossCenterX()`, and `bossCenterY()` are shared by drawing and the
  throw so the poop leaves exactly where the hand is drawn. `drawBoss()`
  is smooth (ellipses, round strokes) rather than faceted because the
  reference is a plush; the hat is clipped rainbow stripes
  (`drawPartyHat()`). Reset with the other gorillas in `spawnHazards()`.
- **Canvas layout**: the canvas is `ROWS + BOSS_BAND_ROWS` row-heights
  tall (see `resizeCanvas()`). `draw()` paints the band
  (`drawBossBand()`), then `translate`s down by the band height so
  everything else keeps the original grid coordinates with row 0 at
  y = 0; the boss and his poop simply draw at negative y. Grid logic
  (movement, collisions, hazard rows) never sees the band.
- **Collision**: `hazardHit()` checks the monkey's current row
  (rounded from its mid-hop tween position) against hazards in that
  row using simple radius overlap, done in pixels: horizontal distance
  is `Δcols * CELL_W`, the threshold is `(MONKEY_RADIUS + hazard
  radius) * SPRITE`. Radii are in `SPRITE` units, not column units.
  Poop uses a 2D distance (`hypot` of the column and row offsets in
  pixels) since it can hit from above.
- **Life loop**: 3 lives, a per-life countdown timer
  (`lifeTime` / `LIFE_TIME_MAX`, 90s) shown as the HUD progress bar.
  A hazard hit or timer expiry calls `loseLife()`, which decrements
  `lives`, plays `sfxLifeLost()`, sets `monkey.dead`, and starts a
  `DEATH_PAUSE` (0.9s) countdown in `deathTimer`. During it the player
  spins and shows X eyes (`deathSpinAngle()`), input is ignored, and
  `loop()` skips the move/timer/hit checks; hazards keep moving. When
  it hits zero, `finishDeath()` respawns via `resetMonkey()` or, on the
  last life, calls `gameOver()`, so the game-over screen waits until
  the hit has been seen. The countdown lives in `loop()`, not a
  `setTimeout`, on purpose (see the level-clear toast note below for
  why timers + game state went wrong before). Gap progress is *not*
  reset on a lost life, only on `newRun()`/`nextLevel()`.
- **Level progression**: clearing a level (`nextLevel()`) resets the
  gaps and monkey position, keeps score/lives, and multiplies hazard
  speed by `speedMul()` (currently `1 + (level-1)*0.22`, compounding
  each level — no cap, no new hazard patterns yet).
- **Controls**: arrow keys / WASD (`keyMap`), plus an on-screen
  touch d-pad (`#btn-up/down/left/right`). Both call `tryMove`. Enter
  or Space clicks Play (splash) or Play Again (game over) when that
  screen is showing.
- **Audio**: WebAudio only, no audio files.
  - Three synth building blocks:
    - `beep()`: fixed-pitch tone (hop, score, level clear, game over,
      new high score, poop plop).
    - `glide()`: pitch slide with soft attack and optional vibrato.
    - `apeVoice()`: the vocal one. A sawtooth with a pitch slide and
      wobble, run through two band-pass filters tuned to vowel formants
      (`VOWELS.oo` / `VOWELS.aa`), which is what makes it sound like an
      ape rather than a beep. `noiseBurst()` adds band-passed white
      noise for breath, rasp, and slaps (the noise buffer is created
      once and reused).
  - Ape sounds, all built from those:
    - `sfxGorillaRoar()` plus `sfxChestBeat()` (six rapid hollow pops)
      when an enemy gorilla starts chest-beating.
    - `sfxOohOoh()` when you park in a gap.
    - `sfxApeCall()`, a chimp-style pant-hoot (accelerating, rising
      "hoo" pants with inhales, then two "aah" screams), on level clear
      and mixed into the music at 75% volume every 36–80 music steps
      (~8–18s, counted in `playMusicStep()`, so muting music mutes these).
    - `sfxLifeLost()` (thud, falling slide, sad whimper) on losing a
      life; deliberately unlike the other sounds so a hit is obvious.
  - A looping background tune is generated the same way: `startMusic()`
    schedules `playMusicStep()` on an interval, stepping through a
    fixed pentatonic note sequence (`MUSIC_SCALE` / `MUSIC_PATTERN`)
    with a light low-thump accent, all via `beep()`. The `#musicBtn`
    toggle flips `musicEnabled` (mute is "don't schedule the next
    note", not a Web Audio gain mute).
  - Audio only starts after a user gesture (`ensureAudio()`, called
    from the start/restart/music buttons and on first keypress), per
    browser autoplay rules; `startMusic()` runs once, the first time
    `ensureAudio()` creates the `AudioContext`, and again from
    `newRun()` on every restart. `gameOver()` calls `stopMusic()`
    (clears the interval) so the loop cuts out under the game-over
    "bummer" sting (`sfxGameOver()`) instead of playing under it.
- **Responsive canvas**: `resizeCanvas()` makes the board fill the
  space left after the HUD/timer-bar/d-pad chrome in both directions.
  Chrome height is measured live: the gap from the top of `.wrap` to
  the bottom of `.dpad`, minus the canvas's own current height, is
  everything else, regardless of breakpoint or the canvas's previous
  size. Cells are **not square**: `CELL_W` and `CELL_H` stretch
  independently to fill the space (capped by `MAX_CELL_W_RATIO` = 3 and
  `MAX_CELL_H_RATIO` = 1.5 so lanes don't get absurd on ultrawide
  screens), and every sprite, the gap ring, and collision radii are
  sized by `SPRITE = min(CELL_W, CELL_H)` so emoji never distort. Rule
  of thumb when drawing: positions use `CELL_W`/`CELL_H`, sizes use
  `SPRITE`. Runs on load, on `resize`, and (after a short delay) on
  `orientationchange`. The CSS breakpoints only scale chrome (HUD font,
  d-pad buttons, monkey rig); `.wrap`'s width is set by JS. **Don't
  put a `max-width` on `.wrap` or `#game`**: an old `max-width: 480px`
  clamped the element narrower than the canvas's internal resolution
  and squashed every sprite sideways. `resizeCanvas()` now reads back
  the canvas's rendered width as a safeguard, so a clamp would shrink
  the board instead of distorting it.
- **Gorilla sprites**: three different looks, each modeled on a
  reference image the owner supplied. All positions use `CELL_W`/`CELL_H`
  and all sizes derive from `SPRITE`.
  - **Player** (and parked players in filled gaps, and the splash
    dancer): `drawGorilla(cx, cy, size, PLAYER_COLORS, { hop, beat,
    dead, angle, g })`, modeled on a Gorilla Tag avatar: low-poly,
    flat-shaded (light / mid / dark facets), front-facing, **no legs**
    (a bulky floating torso), huge arms splayed wide with hands planted
    flat, a big head with a pale face mask, big white eyes, dark brows,
    a two-nostril nose, and a pale chest plate. Brown fur. Built from
    polygons via `shape()`/`limb()`/`ellipseFill()`. Size is
    `playerSize()` (1.0 × `SPRITE`), which is visual only; collisions
    still use `MONKEY_RADIUS`, so the sprite can be resized without
    changing gameplay. Options:
    - `hop`: jump progress (pass `monkey.animT`); lifts the body and
      swings the planted hands up.
    - `beat`: seconds into a chest-beat; the arms come in front of the
      torso and alternate fists onto the chest at
      `CHEST_BEATS_PER_SEC`, and the mouth opens (splash dance).
    - `dead` / `angle`: X eyes and an "o" mouth, rotated by
      `deathSpinAngle()` (two eased spins, settling tipped over).
    - `g`: which canvas context to draw on (default: the game canvas).
  - **The three goal-row gorillas**: `drawHatGorilla(g, cx, cy, size,
    { beat })` (`HAT_PLUSH_COLORS`), modeled on a top-hat Gorilla Tag
    plush: smooth, not faceted. A sitting black plush with grey ears,
    face and chest, a long grey nose ridge, eyes outlined in light-blue
    stitching, a stitched "w" mouth, arms resting down in front with
    hands on the ground, and a tall black top hat with a grey band (a
    faint light rim keeps it readable on the black head). Drawn at
    1.25 × `playerSize()`, standing on the bottom of row 0 with the hat
    reaching up into the boss band (the boss draws in front of it when
    he walks past). `beat` is `GORILLA_SHAKE_TIME - gorillaShake[col]`
    while shaking, else -1; it bounces the body and hat, opens the
    mouth, and alternates fists onto the chest.
  - **The boss**: `drawBoss()`, see Boss gorilla.
  The owner asked specifically that the eyes never be covered: brows sit
  just above the eyes, and nothing (hats, shades) overlaps them. The HUD
  lives counter still uses 🐒 text, and the intro / level-clear /
  game-over screens still use the old SVG cartoon monkey rig.
- **Canvas emoji and `fillStyle`**: color emoji drawn with `fillText`
  take on the alpha of the current `fillStyle`. `draw()` resets
  `fillStyle` to opaque `#fff` before emoji and right after the
  translucent filled-gap highlight. Skipping that made every sprite
  drawn afterward go faded once any gap was filled.
- **All-time bests**: best score and highest level are saved in
  `localStorage` under `bananaDodge.best` (JSON `{score, level}`).
  `loadBest()`/`saveBest()` wrap every access in try/catch, so the game
  still works when storage is unavailable (private browsing). The
  one place that updates them is `recordProgress()`, called from
  `newRun()`, `nextLevel()`, and right after scoring in `finishMove()`.
  Values show on the splash and game-over screens (`.best-score` /
  `.best-level` spans, filled by `updateBestDisplay()`).
- **High-score confetti**: the first time in a run that the score
  passes the best score that existed at run start,
  `recordProgress()` plays `sfxHighScore()` and `launchConfetti()`
  (particles on the fixed, click-through `#confetti` canvas with its
  own rAF loop that stops when the last piece falls off-screen), and
  the game-over screen shows "New high score!". It deliberately does
  **not** fire when there was no previous record (best of 0), so a
  first-ever game doesn't get confetti for its first 50 points.
- **Splash screen** (`#startOverlay.splash`): a title card
  (`.splash-card`) with a kicker line, a two-tone "Banana / Dodge"
  title, a spotlight stage holding `<canvas id="splashDancer">`, the
  tagline, best score / highest level stat tiles, a big Play button,
  and a controls hint (keyboard version, or a touch version via
  `@media (hover: none) and (pointer: coarse)`). The dancer is the
  player gorilla drawn with `drawGorilla(..., { g: splashCtx })` by
  `drawSplashDancer()`, called from the main `loop()` only while the
  splash is visible (no separate rAF). One `DANCE_PERIOD` (4.2s) loop:
  bounce-and-sway groove, chest-beat, hop-spin. The splash card fades
  in with a CSS animation, so a static renderer (e.g. Quick Look)
  shows it invisible; disable the animation to inspect the layout.
- **Other overlay screens**: three more screens (two full-screen, one
  toast), each centered on a hand-built SVG monkey (inline `<svg>` per overlay in `index.html`,
  not an emoji) with independently animated limbs. The rig is a set
  of `<g>` groups (`.m-head`, `.m-tail`, `.m-arm-left/right`,
  `.m-leg-left/right`, `.m-eyes`, `.m-brow-left/right`) each given a
  `transform-origin` at its joint and animated with its own CSS
  keyframes in `banana-dodge.css` — arms swing at the shoulder, legs
  kick at the hip, the tail swishes at its base, eyes blink via
  `scaleY`. A given overlay's expression (sunglasses, eyebrow angle,
  mouth shape, cheek flush) is just different static SVG paths drawn
  into the same anatomy, one full copy per state:
  - `#introOverlay` — `.monkey-cool` (sunglasses pushed up on his
    forehead so the eyes show, arm-pump/leg-kick dance), shown via `showIntro(callback)` for ~1.1s before both
    `startBtn` and `restartBtn` hand off to `newRun()`. Gameplay is
    paused (not yet started) while this shows.
  - `#levelClearOverlay` — `.monkey-happy` (squash-and-stretch jump,
    arms raised in a cheer, sparkle emoji orbiting), triggered by
    `celebrateLevelClear(clearedLevel)` when all 4 gaps are filled.
    Unlike the other three, this one is **not** a blocking full-screen
    modal (class `toast`, not `overlay`) and never touches
    `gameRunning` — `nextLevel()` runs immediately, gameplay never
    pauses, and the toast is a small self-dismissing badge driven
    entirely by the `toastPop` CSS animation plus an `animationend`
    listener that adds `hidden` back. This was a deliberate rewrite
    after the previous pause-based design (`gameRunning = false` for
    ~1.4s behind a full-screen overlay, resumed from a `setTimeout`)
    could get its state clobbered by a hazard/timer check landing in
    the same frame, leaving a dark overlay stuck on screen — the
    fix was to remove the shared timing state entirely rather than
    patch the race. If you touch this again, keep it non-blocking;
    don't reintroduce a `gameRunning` pause tied to a JS timer for a
    purely cosmetic celebration.
  - `#gameOverOverlay` — `.monkey-mean` (angled brows, frown, red
    cheek flush, whole-body shake, small anger-mark emoji), shown by
    `gameOver()` when lives reach 0; stays up until "Play Again" is
    clicked.
  - If you add a fifth state, copy one of the existing `<svg>` blocks
    wholesale (same coordinates) rather than trying to share markup
    via `<use>` — the four overlays are intentionally independent
    copies so each can swap in its own brow/mouth/accessory paths.

## Known gaps / discussed but not built

- No river/log-riding lane (hazards are banana and barrel lanes plus
  gorilla poop).
- No cap on level scaling or new hazard patterns at higher levels —
  it's currently pure speed escalation forever.
- No audio files — both sound effects and the background music loop
  are synthesized via WebAudio oscillators, no samples.

## Conventions if you extend this

- The project is intentionally split into `index.html` (structure),
  `banana-dodge.css` (styling), and `banana-dodge.js` (all game logic).
  Keep new code in the matching file rather than reintroducing inline
  `<style>`/`<script>` blocks.
- Preserve the grid-based movement model (discrete cell hops, not
  free movement) — it's core to the Frogger feel.
- Layout or screen-size changes must not change gameplay feel (hazard
  speed on screen, spacing, timing). The owner has pushed back on this
  explicitly; check speeds in `SPRITE` terms after any resize change.
- New hazard types should follow the existing `laneDefs` /
  `hazards` pattern rather than introducing a separate system.
- Hazard `x` positions are stored in column units (not pixels) so
  they stay correct across `resizeCanvas()` calls; convert with
  `CELL_W` only when drawing or measuring. Sizes/radii are in `SPRITE`
  units. Keep new entities consistent with both conventions.
