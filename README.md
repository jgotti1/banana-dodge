# Banana Dodge

A Frogger-style browser game. Guide a monkey across jungle lanes of flying
bananas and rolling barrels, then slip into one of the four gaps between the
gorillas at the top. Fill all four gaps to clear the level; each level is
faster than the last.

## How to play

- **Move:** arrow keys or WASD, or the on-screen d-pad on touch devices.
- **Goal:** land on an empty gap in the top row (+50 points). Gorillas and
  already-filled gaps block you.
- **Lives:** you have 3. Getting hit by a banana or barrel, or running out
  the 90-second crossing timer, costs a life.
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

## Project layout

- `index.html`: page structure, HUD, canvas, d-pad, and the splash /
  intro / level-clear / game-over screens.
- `banana-dodge.css`: styling, responsive breakpoints, and the animated
  SVG monkey keyframes.
- `banana-dodge.js`: game logic, Canvas 2D rendering, and synthesized
  WebAudio sound effects and music.

Built with plain HTML, CSS, and JavaScript. No frameworks.
