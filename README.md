# Gorilla Fun

**Play it: https://banana-dodge.vercel.app**

A Frogger-style browser game. Guide your gorilla across jungle lanes of
flying bananas and tumbling sticks, dodge whatever the gorillas drop, then slip
into one of the four gaps between them at the top. Fill all four gaps to clear
the level; each level is faster than the last.

The characters are drawn in the style of Gorilla Tag plush toys: you're a
brown gorilla, the three gorillas guarding the top wear top hats, and a
bigger party-hat boss walks the branch above them. The lanes sit over a
jungle photo background, and bananas are a cartoon sprite rather than an
emoji, each tumbling by at its own random angle.

Works on phones, iPads, and desktop. The board stretches to fill the screen
without distorting anything.

## How to play

- **Start:** press Play, or Enter / Space. Enter / Space also works for
  Play Again.
- **Move:** arrow keys or WASD, or the on-screen d-pad on touch devices.
- **Goal:** land on an empty gap in the top row (+50 points). Gorillas and
  already-filled gaps block you. Gorillas already parked in other gaps clap
  and make chimp sounds when you arrive.
- **Watch the gorillas:** every few seconds one of the three top-hat
  gorillas beats its chest and drops poop straight down its column, and
  the party-hat boss walking the branch above them winds up and throws
  some too. Don't be under it. The bottom row is always safe.
- **Lives:** you have 3. Getting hit by a banana, stick, or poop, or
  running out the 90-second crossing timer, costs a life (your gorilla spins
  with ✖✖ eyes before respawning).
- **High scores:** your best score and highest level are saved in your
  browser and shown on the start and game-over screens. If you beat your
  best, the game-over screen celebrates with a message and confetti.
- **Music:** toggle with the 🎵 button in the top-right.

## Running it locally

There's no build step and no dependencies. Open `index.html` in a browser:

```
open index.html
```

To play on a phone or iPad on the same network, serve the folder instead:

```
python3 -m http.server 8000
```

## Deploying

Hosted on Vercel as a static site (no build settings). From this folder:

```
vercel --prod
```

## Project layout

- `index.html`: page structure, HUD, canvas, d-pad, the splash / intro /
  level-clear / game-over screens, and the confetti layer.
- `banana-dodge.css`: styling, responsive breakpoints, and the animated
  SVG monkey keyframes.
- `banana-dodge.js`: game logic, Canvas 2D rendering, and synthesized
  WebAudio sound effects and music.
- `assets/`: the jungle background photo and the banana sprite.

Built with plain HTML, CSS, and JavaScript. No frameworks.
