# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Gorilla Fun

A Frogger-style browser game: a monkey crosses jungle lanes of thrown
bananas and tumbling sticks, dodging poop the three gorillas randomly
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
  the click-through `<canvas id="confetti">`. The browser tab and splash
  screen use the current game name, "Gorilla Fun"; the legacy source
  filenames and deployment URL remain unchanged.
- `banana-dodge.css` — all styling (jungle color theme, HUD layout,
  d-pad grid, overlay screens, monkey-animation keyframes).
- `banana-dodge.js` — all game logic, wrapped in a single IIFE.

Rendering is plain Canvas 2D, driven by a vanilla JS game loop
(`requestAnimationFrame`). No frameworks, no libraries, no build tooling.

## How the game works

- **Grid**: 7 columns x 9 rows, defined in `laneDefs`. Row 0 is the
  goal row (top), row 8 is the start row (bottom).
- **Lane types**: `goal`, `start`, `safe` (median strips), `banana`
  (bananas fly horizontally), `stick` (low-poly sticks tumble horizontally, drawn by `drawStick()` rather than an emoji).
  Each hazard lane has a direction, base speed, hazard count, and
  hazard radius.
- **Goal row**: gorillas sit at columns 1, 3, 5 (`GORILLA_COLS`) and
  block movement into that cell. Gaps are columns 0, 2, 4, 6
  (`GAP_COLS`); landing on an unfilled gap scores 50 and marks it
  filled (an already-filled gap also blocks movement, same as a
  gorilla). Filling all 4 gaps clears the level.
- **Movement**: `tryMove(dir)` handles one step, with a short animation
  tween (`monkey.animT` over `monkey.animDuration`) and a `moveLock` to
  block input spam mid-step. `finishMove()` commits the new position once
  the tween completes and handles gap-arrival logic.
  - Up/down are discrete one-row hops (with the hop bounce).
  - Left/right move one **sprite width**, `min(1, SPRITE / CELL_W)`
    columns, and slide flat (no bounce). Columns stretch up to
    `MAX_CELL_W_RATIO` × `SPRITE` on wide boards, and a full-column step
    there was a big jump; the owner asked for smooth sideways movement.
    So `monkey.col` can be fractional while in the lanes (collision already
    works in continuous pixels). It's clamped to `[0, COLS - 1]` and
    snapped to a whole column when within 1e-6, so repeated steps don't
    drift.
  - Hopping into the goal row snaps `col` to `Math.round(col)` before the
    gorilla/filled-gap checks, so gaps and the parked monkeys stay on exact
    columns.
  - `monkey.animDuration` is `ANIM_DURATION` (120ms per `SPRITE` of
    travel) scaled by the pixels the step actually covers, so on-screen
    speed is constant however `CELL_W`/`CELL_H` are stretched. That's the
    same idea as hazard speed in sprite widths/sec; don't go back to a flat
    per-step duration.
- **Hazards**: the `hazards` array holds live objects with `x`
  position (in column units, not pixels), `speed`, `dir`, updated
  each frame in `updateHazards()`, wrapping around at the grid edges.
  `speed` is in **sprite widths per second**, converted to columns each
  frame (`* SPRITE / CELL_W`), and `spawnHazards()` scales each lane's
  hazard count by `CELL_W / SPRITE`. Together these keep on-screen speed
  and hazard spacing identical to the original square-cell game when
  the board is stretched wide. Don't switch speed back to columns/sec:
  that made hazards 2–3× faster on iPad landscape and desktop.
- **Gorilla patrol**: the three top-hat gorillas are tracked in the
  `gorillas` array (one entry per `GORILLA_COLS` value), each holding
  `homeCol` (its fixed collision/scoring column), a current `x`
  (patrol position, in column units), `dir`, and `shake`.
  `updateGorillas()` walks each idle gorilla back and forth within
  `±GORILLA_PATROL_RANGE` of `homeCol` at `GORILLA_PATROL_SPEED`
  (sprite widths/sec), turning at the ends — the same pattern as
  `updateBoss()`. **This is visual only**: `tryMove()` still blocks
  entry to row 0 using the fixed `GORILLA_COLS`, not each gorilla's
  live `x`, so gap difficulty/scoring is unchanged by this feature.
  Don't change that collision check to track `x` without deciding
  that's an intentional difficulty change.
- **Gorilla poop**: `updateGorillas()` (called from `updateHazards()`)
  counts down `nextDropIn` (random 2.5–6s), then picks a random
  non-shaking gorilla and sets its `shake` to 0.7s as a telegraph: the
  gorilla chest-beats (see Gorilla sprites) while `sfxGorillaRoar()`
  and `sfxChestBeat()` play, and **pauses its patrol** for the same
  reason the boss stands still during his windup. When the shake ends
  it pushes a `type: 'poop'` object into the regular `hazards` array
  at that gorilla's *current* `x` (not `homeCol`), so the drop point
  visually follows wherever it wandered to. Poop moves **vertically**:
  `x` is its column, `y` its row-center position, `speed` in rows/sec
  (scaled by `speedMul()`). It's removed at `POOP_LAND_Y` (top edge of
  the start row), so the start row is always safe; the monkey respawns
  at col 3, directly under the middle gorilla, so this matters.
  `spawnHazards()` rebuilds `gorillas` (resetting patrol position,
  direction, and shake) and resets the drop timer each run/level. Code
  that loops over `hazards` must branch on `type === 'poop'` because
  poop has no `row`/`dir`.
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
  tall (see `resizeCanvas()`). `draw()` paints the jungle background photo
  (see Background photo below), then the band (`drawBossBand()`), then
  `translate`s down by the band height so everything else keeps the
  original grid coordinates with row 0 at y = 0; the boss and his poop
  simply draw at negative y. Grid logic (movement, collisions, hazard
  rows) never sees the band.
- **Banana sprite**: `drawBanana()` draws the cartoon banana image
  (`assets/banana.png`, an owner-supplied reference with its white
  background flood-filled to transparent) instead of the 🍌 emoji.
  Loads once (`bananaImage`/`bananaLoaded`, same pattern as `bgImage`);
  `draw()` skips it until loaded. Drawn at `h.radius * 2 *
  BANANA_DRAW_SCALE * SPRITE` wide (1.3×, aspect-correct height from the
  image) — visual only, `h.radius` itself is untouched so `hazardHit()`'s
  hit box didn't change. Each banana hazard gets its own random tilt
  (`h.angle`, assigned once in `spawnHazards()`, within
  `±BANANA_TILT_VARIANCE` of `BANANA_TILT`, the reference art's diagonal)
  so a lane of bananas doesn't look like one sprite copy-pasted sideways;
  it's fixed for that hazard's lifetime, not re-rolled per frame or on
  wrap. Also mirrored (`g.scale(-1, 1)`) when `h.dir < 0` so it still
  reads as flying the way it's actually moving.
- **Background photo**: `bgImage` (`assets/bg-jungle.jpg`, an
  owner-supplied reference of a Gorilla Tag-style forest) loads once at
  startup; `draw()` skips it until `bgLoaded` flips true, leaving the
  plain `#game` CSS background for the first frame or two. It's drawn
  by `drawImageCover()` across the whole canvas (band + grid) before
  anything else, scaled to cover and cropped rather than stretched, so
  the photo doesn't distort the way lane colors are allowed to stretch.
  The source screenshot's bottom-left camera overlay has been removed.
  `drawBossBand()` no longer paints its own flat gradient — just the
  branch and leaf clusters on top of the photo. `LANE_COLORS` are
  translucent (`rgba(...)`) rather than opaque, and lighter than the raw
  photo, so each lane reads as a tinted overlay hazards stand out
  against — the alpha was raised from an initial ~0.4–0.55 to ~0.6–0.72
  after the first pass made bananas/sticks/poop hard to track against
  the busier parts of the photo (rocks, the cave mouth). If you add a
  lane type, match that range rather than going more transparent.
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
  gaps and monkey position, keeps score, adds one life (`sfxExtraLife()`,
  uncapped — `renderLives()` just repeats an icon per life, no max), and
  multiplies hazard speed by `speedMul()` (currently `1 + (level-1)*0.22`,
  compounding each level — no cap, no new hazard patterns yet). `nextLevel()`
  itself doesn't run until the level-clear cutscene finishes; see
  Level-clear scene below. Hazard *counts* are
  otherwise fixed across levels, except both banana lanes, which have a
  `level1Count` on their `laneDefs` entry that `spawnHazards()` uses
  instead of `count` while `level === 1` (currently 2 on each lane, down
  from 3 and 4) to ease the first level; level 2 on uses the normal
  count. This was tuned twice — trimming just the first banana lane by
  one still wasn't enough, so both lanes now drop to 2.
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
  `MAX_CELL_H_RATIO` = 1.7 so lanes don't get absurd on ultrawide
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
- **Gorilla sprites**: the player and the three goal-row gorillas share
  one drawing, `drawPlushGorilla(g, cx, cy, size, colors, { beat, hop,
  dead, angle, hat })`, modeled on a top-hat Gorilla Tag plush the owner
  supplied: smooth, not faceted. A sitting plush with pale ears, face and
  chest, a long nose ridge, eyes outlined in light-blue stitching, a
  stitched "w" mouth, and arms resting down in front with hands on the
  ground. All positions use `CELL_W`/`CELL_H` and all sizes derive from
  `SPRITE`. The unit-box body spans about y -0.53 to 0.46, so add
  `PLUSH_CENTER_Y * size` to cy to center it on a point. Options:
  - `beat`: seconds into a chest-beat (-1 = none); bounces the body (and
    hat), opens the mouth, alternates fists onto the chest at
    `CHEST_BEATS_PER_SEC`.
  - `hop`: jump progress (pass `monkey.animT`); lifts the body and tucks
    the hands up.
  - `dead` / `angle`: X eyes and an "o" mouth, rotated by
    `deathSpinAngle()` (two eased spins, settling tipped over).
  - `hat`: draws the tall black top hat with a grey band.
  - **Player** (also parked players in filled gaps at 0.9×, the splash
    dancer, and the HUD lives icons): brown `PLAYER_COLORS`, no hat.
    Size is `playerSize()` (1.15 × `SPRITE`), visual only; collisions
    still use `MONKEY_RADIUS`. The HUD lives are `<img class="life-icon">`
    tags repeated by `renderLives()`, all using one small image of the
    player that is drawn on first use and cached as a data URL.
  - **The three goal-row gorillas**: black `HAT_PLUSH_COLORS` with
    `hat: true`, drawn at 1.375 × `SPRITE`, standing on the bottom of row
    0 with the hat reaching up into the boss band (the boss draws in
    front of it when he walks past), at each gorilla's current patrol
    `x` (see Gorilla patrol) rather than its fixed `homeCol`. `beat` is
    `GORILLA_SHAKE_TIME - g.shake` while shaking, else -1.
  - **The boss**: `drawBoss()`, see Boss gorilla.
  The owner asked specifically that the eyes never be covered: brows sit
  just above the eyes, and nothing (hats, shades) overlaps them. The
  level-clear and game-over screens still use the old SVG cartoon
  monkey rig.
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
- **High-score confetti**: `recordProgress()` notes when the score passes
  the best score that existed at run start, but does not interrupt play.
  At the end of that run, `gameOver()` plays `sfxHighScore()` and calls
  `launchConfetti()` (particles on the fixed, click-through `#confetti`
  canvas with its own rAF loop that stops when the last piece falls
  off-screen), and the screen shows "You beat your high score!". It does
  **not** fire when there was no previous record (best of 0), so a
  first-ever game doesn't get confetti for its first 50 points.
- **Parked-player cheers**: after a player lands in an open goal gap, every
  player that was already parked gets `PARKED_CHEER_TIME` seconds of the
  `clap` pose in `drawPlushGorilla()` while `sfxParkedPlayerCheer()` gives
  each one a staggered chimp call and two hand-clap sounds. The newly
  parked player is excluded from this welcome cheer.
- **Player gorilla scenes** (splash, intro, game over): all three are
  built the same way — a small square `<canvas>` inside a "card" overlay,
  drawn with `drawPlushGorilla()` so the sprite always matches the one
  in-game. `makeScene(canvasId, overlayId, drawFn)` builds the per-frame
  draw function the main `loop()` calls for each; it's a no-op while its
  overlay has class `hidden` (no separate rAF), and re-measures the
  canvas after a resize (or the first time the overlay becomes visible).
  - **Splash screen** (`#startOverlay.splash`): a title card
    (`.splash-card`) with a kicker line, a two-tone "Banana / Dodge"
    title, a spotlight stage holding `<canvas id="splashDancer">`, the
    tagline, best score / highest level stat tiles, a big Play button,
    and a controls hint (keyboard version, or a touch version via
    `@media (hover: none) and (pointer: coarse)`). The dancer is drawn
    by `drawDancer()`: one `DANCE_PERIOD` (4.2s) loop — bounce-and-sway
    groove, chest-beat, hop-spin. The splash card fades in with a CSS
    animation, so a static renderer (e.g. Quick Look) shows it
    invisible; disable the animation to inspect the layout.
  - **Intro screen** (`#introOverlay`): "Let's go bananas!" with the
    same `drawDancer()` scene (`<canvas id="introDancer">`), shown via
    `showIntro(callback)` for `INTRO_MS` (6.1s) before both `startBtn`
    and `restartBtn` hand off to `newRun()`. Gameplay is paused (not
    yet started) while this shows.
  - **Game-over screen** (`#gameOverOverlay.gameover`): a card in the
    same visual language as the splash card (`.gameover-card`), tinted
    rose/red instead of jungle green-and-gold — a "Game Over" kicker, a
    stage holding `<canvas id="gameOverDancer">` with two orbiting 💫
    `.dizzy-star` spans, the new-high-score message, the final
    score/level line, best score / highest level stat tiles, and a
    Play Again button styled like the splash's Play button (scoped as
    `.gameover-card .gameover-play` — a bare `.gameover-play` rule loses
    to the generic `.overlay button` on specificity, same trap as
    `.splash-card .splash-play`). The dancer is `drawKnockedOut()`: the
    player tipped at the death-spin's resting angle (`DEATH_TILT`) with
    a slow woozy sway layered on top and `dead: true` (X eyes), since
    `drawPlushGorilla` forces hop/lift to 0 while dead. Shown by
    `gameOver()` when lives reach 0; stays up until "Play Again" is
    clicked.
- **Level-clear toast**: the one remaining hand-built SVG monkey (inline
  `<svg>` in `index.html`, not an emoji), with independently animated
  limbs. The rig is a set of `<g>` groups (`.m-head`, `.m-tail`,
  `.m-arm-left/right`, `.m-leg-left/right`, `.m-eyes`, `.m-brow-left/right`)
  each given a `transform-origin` at its joint and animated with its own
  CSS keyframes in `banana-dodge.css` — arms swing at the shoulder, legs
  kick at the hip, the tail swishes at its base, eyes blink via `scaleY`.
  `#levelClearOverlay` — `.monkey-happy` (squash-and-stretch jump, arms
  raised in a cheer, sparkle emoji orbiting), triggered by
  `celebrateLevelClear(clearedLevel)` when all 4 gaps are filled. It's a
  small self-dismissing badge (class `toast`, not `overlay`) driven
  entirely by the `toastPop` CSS animation plus an `animationend`
  listener that adds `hidden` back — independent of and layered on top
  of the canvas cutscene below, which is what actually holds up
  `nextLevel()` now.
- **Level-clear scene**: a Pac-Man-style "parade" that plays on the game
  canvas itself between clearing a level and `nextLevel()` running: the
  boss gorilla runs off the right edge, then the three top-hat gorillas
  follow in a staggered chase, then the player — now carrying a small
  wooden "NEXT LEVEL" sign (`drawLevelSign()`) — runs off after them.
  `finishMove()` calls `startLevelClearScene(level)` instead of
  `nextLevel()` directly when `gaps.every(g => g.filled)`; it clears
  `hazards`, resets any gorilla mid-chest-beat / boss mid-windup pose so
  nobody runs off frozen in it, and builds a `levelClearScene` object
  with one `{x, delay, done}` entry per actor (boss, each gorilla,
  player), staggered by `LEVEL_SCENE_BOSS_HEAD_START` /
  `LEVEL_SCENE_GORILLA_GAP` / `LEVEL_SCENE_PLAYER_GAP`.
  `updateLevelClearScene()` — called from `loop()`, **not** a
  `setTimeout`, the same pattern as `deathTimer`/`DEATH_PAUSE` — advances
  each actor past its delay at `LEVEL_SCENE_RUN_SPEED` and syncs its
  scene-local `x` straight onto the live object (`boss.x`,
  `gorillas[i].x`, `monkey.col`) that `draw()` already reads, so no
  drawing changes were needed to move them; `sceneRunBounce()` adds a
  running bounce once an actor is under way. Once every actor's `x`
  passes `LEVEL_SCENE_EXIT_X` (off the right edge — the canvas clips the
  rest, nothing needs explicit hiding), `levelClearScene` is cleared and
  `nextLevel()` finally runs, which is also where gorillas/boss/hazards
  get reset back to normal. While `levelClearScene` is set, `loop()`
  skips `updateHazards`/the death timer/the life timer/hit checks
  entirely (gameplay is effectively frozen for the cutscene's duration),
  and `tryMove()` also bails early, but **`gameRunning` itself is never
  set to `false`** for this — this was written carefully to avoid
  repeating the old level-clear-toast bug (a `gameRunning = false` +
  `setTimeout` pause could get its state clobbered by a hazard/timer
  check landing in the same frame, leaving a dark overlay stuck on
  screen). If you touch this again, keep the pause frame-driven through
  `levelClearScene`/`loop()`; don't reach for `gameRunning` + `setTimeout`.

## Known gaps / discussed but not built

- No river/log-riding lane (hazards are banana and stick lanes plus
  gorilla poop).
- No cap on level scaling or new hazard patterns at higher levels —
  it's currently pure speed escalation forever.
- No audio files — both sound effects and the background music loop
  are synthesized via WebAudio oscillators, no samples.

## Portfolio card

The README ends with a hidden JSON block (`<!-- portfolio-card:start ... portfolio-card:end -->`) that is machine-readable by a portfolio site. It contains the project title, description, live URL, GitHub link, thumbnail image, tech stack, and key features. Keep it in sync when the project features, tech stack, live URL, or deployed appearance changes. The JSON must remain valid and contain no `--` sequences (which would close the HTML comment early).

## Conventions if you extend this

- The project is intentionally split into `index.html` (structure),
  `banana-dodge.css` (styling), and `banana-dodge.js` (all game logic).
  Keep new code in the matching file rather than reintroducing inline
  `<style>`/`<script>` blocks.
- Preserve the step-based movement model (discrete steps, not free
  movement): one row per up/down hop, one sprite width per left/right
  step. It's core to the Frogger feel.
- Layout or screen-size changes must not change gameplay feel (hazard
  speed on screen, spacing, timing). The owner has pushed back on this
  explicitly; check speeds in `SPRITE` terms after any resize change.
- New hazard types should follow the existing `laneDefs` /
  `hazards` pattern rather than introducing a separate system.
- Hazard `x` positions are stored in column units (not pixels) so
  they stay correct across `resizeCanvas()` calls; convert with
  `CELL_W` only when drawing or measuring. Sizes/radii are in `SPRITE`
  units. Keep new entities consistent with both conventions.
