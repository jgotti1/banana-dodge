# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Banana Dodge

A Frogger-style browser game: a monkey crosses jungle lanes of thrown
bananas and rolling barrels to reach one of four gaps between three
gorillas at the top of the board.

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

There is no package.json, linter, or test suite in this repo.

## Current state

The game lives in three files:

- `index.html` — a normal HTML5 document skeleton (`<!DOCTYPE html>`,
  `<head>` with charset/viewport meta, a `<link>` to the stylesheet) plus
  the body markup: the HUD, the `<canvas id="game">`, the on-screen d-pad,
  and four full-screen overlays (`#startOverlay`, `#introOverlay`,
  `#levelClearOverlay`, `#gameOverOverlay`).
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
- **Collision**: `hazardHit()` checks the monkey's current row
  (rounded from its mid-hop tween position) against hazards in that
  row using simple radius overlap (`MONKEY_RADIUS` + hazard radius).
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
  - `beep()` synthesizes short sound effects (hop, score, hit, level
    clear, game over).
  - A looping background tune is generated the same way: `startMusic()`
    schedules `playMusicStep()` on an interval, stepping through a
    fixed pentatonic note sequence (`MUSIC_SCALE` / `MUSIC_PATTERN`)
    with a light low-thump accent, all via `beep()`. The `#musicBtn`
    toggle flips `musicEnabled` (mute is "don't schedule the next
    note", not a Web Audio gain mute).
  - Audio only starts after a user gesture (`ensureAudio()`, called
    from the start/restart/music buttons and on first keypress), per
    browser autoplay rules; `startMusic()` runs once, the first time
    `ensureAudio()` creates the `AudioContext`.
- **Responsive canvas**: `resizeCanvas()` recomputes `CELL` from the
  canvas's actual CSS width so the grid scales to the container.
- **Overlay screens**: four full-screen overlays, each centered on a
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
    arms raised in a cheer, sparkle emoji orbiting), shown via
    `showLevelClear()` when all 4 gaps are filled; it sets
    `gameRunning = false` for ~1.4s, then calls `nextLevel()` and
    resumes.
  - `#gameOverOverlay` — `.monkey-mean` (angled brows, frown, red
    cheek flush, whole-body shake, small anger-mark emoji), shown by
    `gameOver()` when lives reach 0; stays up until "Play Again" is
    clicked.
  - If you add a fifth state, copy one of the existing `<svg>` blocks
    wholesale (same coordinates) rather than trying to share markup
    via `<use>` — the four overlays are intentionally independent
    copies so each can swap in its own brow/mouth/accessory paths.

## Known gaps / discussed but not built

- No river/log-riding lane (only banana and barrel hazard lanes
  exist right now).
- No cap on level scaling or new hazard patterns at higher levels —
  it's currently pure speed escalation forever.
- No persistent high score (nothing is saved to storage).
- No audio files — both sound effects and the background music loop
  are synthesized via WebAudio oscillators, no samples.

## Conventions if you extend this

- The project is intentionally split into `index.html` (structure),
  `banana-dodge.css` (styling), and `banana-dodge.js` (all game logic).
  Keep new code in the matching file rather than reintroducing inline
  `<style>`/`<script>` blocks.
- Preserve the grid-based movement model (discrete cell hops, not
  free movement) — it's core to the Frogger feel.
- New hazard types should follow the existing `laneDefs` /
  `hazards` pattern rather than introducing a separate system.
- Hazard `x` positions are stored in column units (not pixels) so
  they stay correct across `resizeCanvas()` calls — keep new hazard
  or entity code consistent with that unit convention.
