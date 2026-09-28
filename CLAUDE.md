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
  telegraph (drawn as a jitter/tilt, plus `sfxGrumble()`). When the
  shake ends it pushes a `type: 'poop'` object into the regular
  `hazards` array. Poop moves **vertically**: `x` is its column, `y` its
  row-center position, `speed` in rows/sec (scaled by `speedMul()`).
  It's removed at `POOP_LAND_Y` (top edge of the start row), so the
  start row is always safe; the monkey respawns at col 3, directly
  under the middle gorilla, so this matters. `spawnHazards()` clears
  poop and resets the shake/drop timers each run/level. Code that
  loops over `hazards` must branch on `type === 'poop'` because poop
  has no `row`/`dir`.
- **Collision**: `hazardHit()` checks the monkey's current row
  (rounded from its mid-hop tween position) against hazards in that
  row using simple radius overlap, done in pixels: horizontal distance
  is `Δcols * CELL_W`, the threshold is `(MONKEY_RADIUS + hazard
  radius) * SPRITE`. Radii are in `SPRITE` units, not column units.
  Poop uses a 2D distance (`hypot` of the column and row offsets in
  pixels) since it can hit from above.
- **Life loop**: 3 lives, a per-life countdown timer
  (`lifeTime` / `LIFE_TIME_MAX`, 90s) shown as the HUD progress bar.
  Losing a life (hazard hit or timer expiry) or running out of time
  respawns the monkey at the start row via `resetMonkey()`; losing
  the last life calls `gameOver()`. Gap progress is *not* reset on a
  lost life, only on `newRun()`/`nextLevel()`.
- **Level progression**: clearing a level (`nextLevel()`) resets the
  gaps and monkey position, keeps score/lives, and multiplies hazard
  speed by `speedMul()` (currently `1 + (level-1)*0.22`, compounding
  each level — no cap, no new hazard patterns yet).
- **Controls**: arrow keys / WASD (`keyMap`), plus an on-screen
  touch d-pad (`#btn-up/down/left/right`). Both call `tryMove`.
- **Audio**: WebAudio only, no audio files.
  - `beep()` synthesizes short sound effects: hop, score, hit, level
    clear, game over, new high score, gorilla grumble, poop plop.
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
- **Overlay screens**: four screens (three full-screen, one toast), each centered on a
  hand-built SVG monkey (inline `<svg>` per overlay in `index.html`,
  not an emoji) with independently animated limbs. The rig is a set
  of `<g>` groups (`.m-head`, `.m-tail`, `.m-arm-left/right`,
  `.m-leg-left/right`, `.m-eyes`, `.m-brow-left/right`) each given a
  `transform-origin` at its joint and animated with its own CSS
  keyframes in `banana-dodge.css` — arms swing at the shoulder, legs
  kick at the hip, the tail swishes at its base, eyes blink via
  `scaleY`. A given overlay's expression (sunglasses, eyebrow angle,
  mouth shape, cheek flush) is just different static SVG paths drawn
  into the same anatomy, one full copy per state:
  - `#startOverlay` — the splash screen, `.monkey-idle` (gentle sway,
    blink, tail swish), shown on load until "Start Game" is clicked.
  - `#introOverlay` — `.monkey-cool` (sunglasses, arm-pump/leg-kick
    dance), shown via `showIntro(callback)` for ~1.1s before both
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
