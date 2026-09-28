(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const COLS = 7;
  const ROWS = 9;
  const GORILLA_COLS = [1, 3, 5];
  const GAP_COLS = [0, 2, 4, 6];
  const MONKEY_RADIUS = 0.32;
  const ANIM_DURATION = 120; // ms per hop
  const LIFE_TIME_MAX = 90; // seconds

  // Gorilla poop: a random gorilla shakes (telegraph), then drops poop that
  // falls straight down its column. It splats at the top of the start row,
  // which stays safe so a respawned monkey can't be hit instantly.
  const POOP_RADIUS = 0.24; // sprite units; also the hit-box radius, see hazardHit()
  const POOP_DRAW_SCALE = 1.1; // visual only — drawn 110% of POOP_RADIUS, hit box unchanged
  const POOP_FALL_SPEED = 2.6; // rows per second at level 1
  const POOP_LAND_Y = ROWS - 1.5; // row-center coords: top edge of start row
  const GORILLA_SHAKE_TIME = 0.7; // seconds of warning before the drop
  const DROP_INTERVAL_MIN = 2.5;
  const DROP_INTERVAL_MAX = 6;
  const DEATH_PAUSE = 0.9; // seconds the X-eyed player stays on screen after a hit

  // Boss gorilla: a bigger party-hat gorilla on a branch in a band above
  // the goal row. He waddles side to side, and every few seconds stops,
  // lifts the poop he's holding overhead, and throws it straight down.
  const BOSS_BAND_ROWS = 1.8; // height of the band above row 0, in row heights
  const BOSS_SPEED = 1.3; // sprite widths per second
  const BOSS_MIN_X = 0.8; // column range his center walks between
  const BOSS_MAX_X = COLS - 1.5;
  const BOSS_WINDUP = 0.6; // seconds lifting the poop before the throw
  const BOSS_RELOAD = 0.9; // seconds empty-handed after a throw
  const BOSS_THROW_MIN = 3;
  const BOSS_THROW_MAX = 7;
  const BOSS_HAND_UP = [-0.3, -0.62]; // raised throwing hand, in boss unit space

  const EMOJI_FONT = 'Apple Color Emoji, "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

  // Row 0 = goal (top), row 8 = start (bottom).
  const laneDefs = [
    { type: 'goal' },
    { type: 'safe' },
    // level1Count on both banana lanes eases level 1 (it was still too
    // hard with just the first lane trimmed by one); level 2 on uses the
    // normal count, see spawnHazards().
    { type: 'banana', dir: 1, baseSpeed: 1.4, count: 3, level1Count: 2, radius: 0.22 },
    { type: 'stick', dir: -1, baseSpeed: 1.1, count: 2, radius: 0.34 },
    { type: 'safe' },
    // Row 5 is the first banana lane the player reaches leaving the start
    // row (row 8, moving up through the row-6 stick lane).
    { type: 'banana', dir: -1, baseSpeed: 1.7, count: 4, level1Count: 2, radius: 0.22 },
    { type: 'stick', dir: 1, baseSpeed: 1.3, count: 2, radius: 0.34 },
    { type: 'safe' },
    { type: 'start' },
  ];

  // Lane rows are tinted, translucent overlays (not opaque fills) so the
  // jungle background photo (see bgImage below) shows through underneath;
  // the alpha per type is what keeps banana/stick lanes readable against
  // whatever the photo is doing in that stripe.
  const LANE_COLORS = {
    goal: 'rgba(40, 78, 48, 0.72)',
    start: 'rgba(90, 145, 88, 0.62)',
    safe: 'rgba(100, 160, 98, 0.6)',
    banana: 'rgba(128, 100, 50, 0.68)',
    stick: 'rgba(158, 146, 92, 0.68)', // lighter dirt so the brown sticks stand out
  };

  // Jungle background photo (owner-supplied reference), drawn cover-fit
  // behind the boss band and the lane grid. Loads once; draw() just no-ops
  // the drawImage call until it's ready, leaving the plain canvas
  // background (dark, from CSS `#game { background: var(--panel) }`)
  // showing for that first frame or two.
  const bgImage = new Image();
  let bgLoaded = false;
  bgImage.onload = () => { bgLoaded = true; };
  bgImage.src = 'assets/bg-jungle.jpg';

  // Draws `img` into (x, y, w, h) scaled to cover the whole box (cropping
  // whichever axis overhangs) rather than stretched, so the photo doesn't
  // distort the way lane colors are allowed to stretch.
  function drawImageCover(g, img, x, y, w, h) {
    const scale = Math.max(w / img.width, h / img.height);
    const iw = img.width * scale;
    const ih = img.height * scale;
    g.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }

  // Cartoon banana sprite (owner-supplied reference, background removed),
  // replacing the flat 🍌 emoji. Drawn a bit larger than the emoji was
  // (BANANA_DRAW_SCALE, visual only — h.radius, the hit box hazardHit()
  // uses, is untouched) and tilted around BANANA_TILT (the reference art's
  // diagonal); each banana hazard gets its own random tilt within
  // ±BANANA_TILT_VARIANCE of that, fixed for its lifetime (assigned once
  // in spawnHazards()), so a lane of bananas doesn't look like one sprite
  // copy-pasted sideways. Mirrored by travel direction so the curl's high
  // side always trails and it reads as flying the way it's actually moving.
  const bananaImage = new Image();
  let bananaLoaded = false;
  bananaImage.onload = () => { bananaLoaded = true; };
  bananaImage.src = 'assets/banana.png';
  const BANANA_DRAW_SCALE = 1.3;
  const BANANA_TILT = -0.4; // radians; matches the reference art's diagonal
  const BANANA_TILT_VARIANCE = Math.PI / 4; // ±45° of random spread per banana

  function drawBanana(g, cx, cy, size, dir, angle) {
    if (!bananaLoaded) return;
    const w = size;
    const h = size * (bananaImage.height / bananaImage.width);
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    if (dir < 0) g.scale(-1, 1); // mirror so it leads with its tip when flying left
    g.drawImage(bananaImage, -w / 2, -h / 2, w, h);
    g.restore();
  }

  const keyMap = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
  };

  const DIRS = {
    up: { dc: 0, dr: -1 },
    down: { dc: 0, dr: 1 },
    left: { dc: -1, dr: 0 },
    right: { dc: 1, dr: 0 },
  };

  // Cells can be wider (or a bit taller) than they are square so the board
  // fills the screen; sprites are always sized by SPRITE (the smaller side)
  // so they never stretch. Hazard/monkey radii are in SPRITE units.
  let CELL_W = 60;
  let CELL_H = 60;
  let SPRITE = 60;
  const MAX_CELL_W_RATIO = 3;
  const MAX_CELL_H_RATIO = 1.7;
  let hazards = [];
  let gorillaShake = {}; // gorilla col -> seconds of shaking left
  let boss = { x: 3, dir: 1, windup: 0, reload: 0, nextThrowIn: 4 };
  let nextDropIn = 0;
  const gaps = GAP_COLS.map(col => ({ col, filled: false }));
  let monkey, moveLock, level, score, lives, lifeTime, gameRunning;
  let deathTimer = 0;
  let lastTime = 0;

  // --- audio: sound effects ---
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    startMusic();
  }
  function beep(freq = 440, duration = 0.08, type = 'square', gain = 0.05, delay = 0) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(g);
    g.connect(audioCtx.destination);
    const t = audioCtx.currentTime + delay;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
  const sfxHop = () => beep(520, 0.05, 'square', 0.04);
  const sfxScore = () => { beep(660, 0.08, 'triangle', 0.06); beep(880, 0.1, 'triangle', 0.06, 0.08); };
  const sfxPlop = () => { beep(420, 0.06, 'sine', 0.06); beep(210, 0.12, 'sine', 0.06, 0.05); };
  const sfxHighScore = () => [784, 988, 1175, 1568, 1976].forEach((f, i) => beep(f, 0.14, 'triangle', 0.06, i * 0.08));
  const sfxLevel = () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.12, 'triangle', 0.06, i * 0.1));
  const sfxGameOver = () => {
    [400, 300, 200, 150].forEach((f, i) => beep(f, 0.22, 'sawtooth', 0.07, i * 0.18));
    beep(90, 0.6, 'sawtooth', 0.08, 4 * 0.18); // final low "womp" for a sad-trombone finish
  };

  // Like beep(), but the pitch slides from f0 to f1 with a soft attack and
  // optional vibrato (Hz of wobble). Sliding, wobbly tones read as vocal,
  // which is how the ape calls below sound like hoots instead of beeps.
  function glide(f0, f1, duration, { type = 'triangle', gain = 0.05, delay = 0, vibrato = 0 } = {}) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g);
    g.connect(audioCtx.destination);
    if (vibrato) {
      const lfo = audioCtx.createOscillator();
      const depth = audioCtx.createGain();
      lfo.frequency.value = 7;
      depth.gain.value = vibrato;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + duration + 0.02);
    }
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // --- audio: ape sounds ---
  // A voice is a buzzy sawtooth run through two band-pass filters tuned to
  // vowel "formants" (the mouth resonances that make "oo" sound different
  // from "aa"). That, plus a pitch slide and wobble, is what makes these
  // read as ape hoots and screams instead of beeps.
  const VOWELS = {
    oo: [[330, 7], [760, 9]],
    aa: [[780, 6], [1180, 8]],
  };

  function apeVoice(f0, f1, duration, { vowel = 'oo', gain = 0.12, delay = 0, wobble = 0.03 } = {}) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + duration);

    const lfo = audioCtx.createOscillator();
    const lfoDepth = audioCtx.createGain();
    lfo.frequency.value = 6;
    lfoDepth.gain.value = f0 * wobble;
    lfo.connect(lfoDepth);
    lfoDepth.connect(osc.frequency);

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.035);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    env.connect(audioCtx.destination);
    for (const [freq, q] of VOWELS[vowel]) {
      const bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      osc.connect(bp);
      bp.connect(env);
    }
    osc.start(t);
    lfo.start(t);
    osc.stop(t + duration + 0.02);
    lfo.stop(t + duration + 0.02);
  }

  let noiseBuffer = null;
  function noiseBurst(duration, { freq = 1200, q = 1, gain = 0.05, delay = 0 } = {}) {
    if (!audioCtx) return;
    if (!noiseBuffer) {
      noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = audioCtx.currentTime + delay;
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(bp);
    bp.connect(env);
    env.connect(audioCtx.destination);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  // Chimp-style pant-hoot: breathy "hoo" pants that speed up and climb in
  // pitch, with an inhale between each, climaxing in two "aah" screams.
  // vol scales the whole call (the music mixes it in quieter).
  const sfxApeCall = (vol = 1, delay = 0) => {
    const hoots = [0, 0.22, 0.41, 0.57, 0.7, 0.81];
    hoots.forEach((d, i) => {
      const base = 230 + i * 45;
      apeVoice(base, base * 1.35, 0.13, { vowel: 'oo', gain: 0.13 * vol, delay: delay + d });
      noiseBurst(0.06, { freq: 1500, q: 0.8, gain: 0.025 * vol, delay: delay + d + 0.13 }); // inhale
    });
    [0.95, 1.2].forEach((d, i) =>
      apeVoice(880 - i * 60, 640, 0.24, { vowel: 'aa', gain: 0.12 * vol, delay: delay + d, wobble: 0.06 }));
  };
  const sfxOohOoh = (delay = 0) =>
    [0, 0.15].forEach(d => apeVoice(320, 480, 0.12, { vowel: 'oo', gain: 0.12, delay: delay + d }));
  // Losing a life: a thud, a cartoon falling slide, and a sad descending
  // ape whimper. Deliberately unlike the hop/score beeps so it's unmistakable.
  const sfxLifeLost = () => {
    noiseBurst(0.12, { freq: 300, q: 1, gain: 0.12 });
    glide(760, 110, 0.5, { type: 'square', gain: 0.045 });
    apeVoice(480, 210, 0.4, { vowel: 'oo', gain: 0.13, delay: 0.14, wobble: 0.05 });
  };
  // Loud gorilla roar that goes with the chest-beat: a deep growling "aah"
  // with a scream layered an octave-ish above it and a breathy rasp.
  const sfxGorillaRoar = () => {
    apeVoice(210, 150, 0.75, { vowel: 'aa', gain: 0.22, wobble: 0.09 });
    apeVoice(560, 380, 0.6, { vowel: 'aa', gain: 0.12, delay: 0.05, wobble: 0.07 });
    noiseBurst(0.6, { freq: 900, q: 0.7, gain: 0.05 });
  };
  // Hollow, rapid "pok-pok-pok": a quick low pitch drop plus a slap of noise.
  const sfxBossThrow = () => {
    apeVoice(300, 470, 0.18, { vowel: 'aa', gain: 0.13 }); // "hah!"
    noiseBurst(0.18, { freq: 2000, q: 0.7, gain: 0.04 }); // whoosh
    sfxPlop();
  };
  const sfxChestBeat = () =>
    [0, 0.085, 0.17, 0.255, 0.34, 0.425].forEach(d => {
      glide(240, 85, 0.07, { type: 'sine', gain: 0.12, delay: d });
      noiseBurst(0.04, { freq: 500, q: 1.5, gain: 0.05, delay: d });
    });

  // --- audio: looping "fun monkey" background music ---
  // Bouncy marimba-style pentatonic riff with a light bongo thump, all synthesized (no audio files).
  const MUSIC_SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]; // C D E G A C
  const MUSIC_PATTERN = [0, 2, 4, 2, 3, 5, 3, 2, 0, 4, 2, 4, 3, 5, 4, 2];
  const NOTE_MS = 220;
  let musicIndex = 0;
  let musicTimer = null;
  let musicEnabled = true;
  // Quiet ape calls mixed into the music every ~8-18s (36-80 steps).
  const randomApeCallSteps = () => 36 + Math.floor(Math.random() * 45);
  let stepsToApeCall = randomApeCallSteps();

  function playMusicStep() {
    if (!musicEnabled || !audioCtx) return;
    const step = musicIndex % MUSIC_PATTERN.length;
    const freq = MUSIC_SCALE[MUSIC_PATTERN[step]];
    const accent = step % 4 === 0;
    beep(freq, 0.18, 'triangle', accent ? 0.05 : 0.032);
    if (step % 2 === 0) beep(110, 0.06, 'sine', 0.02); // bongo thump on the downbeat
    if (--stepsToApeCall <= 0) {
      sfxApeCall(0.75);
      stepsToApeCall = randomApeCallSteps();
    }
    musicIndex++;
  }

  function startMusic() {
    if (musicTimer) return;
    musicTimer = setInterval(playMusicStep, NOTE_MS);
  }

  function stopMusic() {
    clearInterval(musicTimer);
    musicTimer = null;
  }

  function toggleMusic() {
    musicEnabled = !musicEnabled;
    document.getElementById('musicBtn').textContent = musicEnabled ? '🎵' : '🔇';
  }

  // --- all-time bests (localStorage) ---
  // Storage can throw or be empty (private browsing, cleared site data), so
  // every access is guarded and the game works fine without it.
  const BEST_KEY = 'bananaDodge.best';
  function loadBest() {
    try {
      const saved = JSON.parse(localStorage.getItem(BEST_KEY)) || {};
      return { score: Number(saved.score) || 0, level: Number(saved.level) || 0 };
    } catch {
      return { score: 0, level: 0 };
    }
  }
  function saveBest() {
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(best));
    } catch {
      // ignore: bests just won't persist this session
    }
  }
  const best = loadBest();
  let bestScoreAtRunStart = 0;
  let beatBestThisRun = false;

  function updateBestDisplay() {
    document.querySelectorAll('.best-score').forEach(el => { el.textContent = best.score; });
    document.querySelectorAll('.best-level').forEach(el => { el.textContent = best.level; });
  }

  // Confetti only fires when a previous record existed to beat, and only
  // once per run (the first moment the score passes it).
  function recordProgress() {
    let changed = false;
    if (score > best.score) {
      best.score = score;
      changed = true;
      if (!beatBestThisRun && bestScoreAtRunStart > 0) {
        beatBestThisRun = true;
        sfxHighScore();
        launchConfetti();
      }
    }
    if (level > best.level) {
      best.level = level;
      changed = true;
    }
    if (changed) {
      saveBest();
      updateBestDisplay();
    }
  }

  // --- confetti ---
  const confettiCanvas = document.getElementById('confetti');
  const confettiCtx = confettiCanvas.getContext('2d');
  const CONFETTI_COLORS = ['#f5c542', '#ff6b6b', '#4ecdc4', '#ffffff', '#a66cff', '#7bd389'];
  let confettiPieces = [];
  let confettiRunning = false;

  function launchConfetti() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    confettiCanvas.width = Math.round(w * dpr);
    confettiCanvas.height = Math.round(h * dpr);
    confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (let i = 0; i < 180; i++) {
      confettiPieces.push({
        x: Math.random() * w,
        y: -20 - Math.random() * h * 0.5,
        vx: (Math.random() - 0.5) * 160,
        vy: 140 + Math.random() * 200,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 12,
        sway: Math.random() * Math.PI * 2,
        pw: 6 + Math.random() * 6,
        ph: 9 + Math.random() * 8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      });
    }
    if (confettiRunning) return;
    confettiRunning = true;

    let last = performance.now();
    const step = (t) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      confettiCtx.clearRect(0, 0, w, h);
      confettiPieces = confettiPieces.filter(p => p.y < h + 30);
      for (const p of confettiPieces) {
        p.sway += dt * 4;
        p.x += (p.vx + Math.sin(p.sway) * 40) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rot);
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.pw / 2, -p.ph / 2, p.pw, p.ph);
        confettiCtx.restore();
      }
      if (confettiPieces.length) {
        requestAnimationFrame(step);
      } else {
        confettiRunning = false;
        confettiCtx.clearRect(0, 0, w, h);
      }
    };
    requestAnimationFrame(step);
  }

  // --- level / hazard setup ---
  function speedMul() {
    return 1 + (level - 1) * 0.22;
  }

  // laneDefs speeds and counts are tuned for square cells. When cells are
  // stretched wider than a sprite, speed is kept in sprite widths/sec (so
  // hazards move the same on-screen speed) and the count is scaled up with
  // the lane's width (so the spacing between hazards stays the same). Net
  // effect: gameplay feels identical on any screen shape.
  function spawnHazards() {
    hazards = [];
    const stretch = CELL_W / SPRITE;
    laneDefs.forEach((lane, row) => {
      if (lane.type !== 'banana' && lane.type !== 'stick') return;
      const baseCount = (level === 1 && lane.level1Count != null) ? lane.level1Count : lane.count;
      const count = Math.max(baseCount, Math.round(baseCount * stretch));
      for (let i = 0; i < count; i++) {
        hazards.push({
          row,
          type: lane.type,
          dir: lane.dir,
          radius: lane.radius,
          speed: lane.baseSpeed * speedMul(), // sprite widths per second
          x: ((COLS / count) * i + row * 0.4) % COLS,
          // Random per-banana tilt, fixed for its lifetime, so a lane of
          // bananas doesn't look like one sprite copy-pasted sideways.
          angle: lane.type === 'banana' ? BANANA_TILT + (Math.random() * 2 - 1) * BANANA_TILT_VARIANCE : 0,
        });
      }
    });
    gorillaShake = {};
    nextDropIn = randomDropInterval();
    boss = {
      x: (BOSS_MIN_X + BOSS_MAX_X) / 2,
      dir: Math.random() < 0.5 ? -1 : 1,
      windup: 0,
      reload: 0,
      nextThrowIn: randomBossThrow(),
    };
  }

  function randomDropInterval() {
    return DROP_INTERVAL_MIN + Math.random() * (DROP_INTERVAL_MAX - DROP_INTERVAL_MIN);
  }

  function randomBossThrow() {
    return BOSS_THROW_MIN + Math.random() * (BOSS_THROW_MAX - BOSS_THROW_MIN);
  }

  // Boss geometry, shared by drawing and by the throw (so the poop leaves
  // exactly where his raised hand is drawn). y is in the translated grid
  // space draw() uses, where row 0 starts at y = 0 and the band is above it.
  const bossSize = () => SPRITE * 1.3;
  const bossCenterX = () => (boss.x + 0.5) * CELL_W;
  const bossCenterY = () => -0.1 * CELL_H - 0.38 * bossSize();

  function updateBoss(dt) {
    if (boss.reload > 0) boss.reload -= dt;
    if (boss.windup > 0) {
      boss.windup -= dt;
      if (boss.windup <= 0) {
        const px = bossCenterX() + BOSS_HAND_UP[0] * bossSize();
        const py = bossCenterY() + BOSS_HAND_UP[1] * bossSize();
        hazards.push({
          type: 'poop',
          x: px / CELL_W - 0.5,
          y: py / CELL_H - 0.5,
          radius: POOP_RADIUS,
          speed: POOP_FALL_SPEED * speedMul(),
        });
        boss.reload = BOSS_RELOAD;
        sfxBossThrow();
      }
      return; // he stands still while winding up
    }
    boss.x += boss.dir * BOSS_SPEED * (SPRITE / CELL_W) * dt;
    if (boss.x < BOSS_MIN_X) { boss.x = BOSS_MIN_X; boss.dir = 1; }
    if (boss.x > BOSS_MAX_X) { boss.x = BOSS_MAX_X; boss.dir = -1; }
    boss.nextThrowIn -= dt;
    if (boss.nextThrowIn <= 0 && boss.reload <= 0) {
      boss.windup = BOSS_WINDUP;
      boss.nextThrowIn = randomBossThrow();
      sfxOohOoh();
    }
  }

  // Poop lives in the same `hazards` array as bananas/sticks (type 'poop'),
  // but moves vertically: x is its column, y is its row-center position.
  function updateGorillas(dt) {
    nextDropIn -= dt;
    if (nextDropIn <= 0) {
      const idle = GORILLA_COLS.filter(col => !(gorillaShake[col] > 0));
      if (idle.length) {
        gorillaShake[idle[Math.floor(Math.random() * idle.length)]] = GORILLA_SHAKE_TIME;
        sfxGorillaRoar();
        sfxChestBeat();
      }
      nextDropIn = randomDropInterval();
    }
    for (const col of GORILLA_COLS) {
      if (!(gorillaShake[col] > 0)) continue;
      gorillaShake[col] -= dt;
      if (gorillaShake[col] <= 0) {
        hazards.push({
          type: 'poop',
          x: col,
          y: 0.4,
          radius: POOP_RADIUS,
          speed: POOP_FALL_SPEED * speedMul(),
        });
        sfxPlop();
      }
    }
  }

  function resetMonkey() {
    monkey = {
      col: 3, row: ROWS - 1,
      animFrom: { col: 3, row: ROWS - 1 },
      animTo: { col: 3, row: ROWS - 1 },
      animT: 1,
      animDuration: ANIM_DURATION,
      dead: false,
    };
    moveLock = false;
    deathTimer = 0;
  }

  function newRun() {
    level = 1;
    score = 0;
    lives = 3;
    gaps.forEach(g => { g.filled = false; });
    lifeTime = LIFE_TIME_MAX;
    resetMonkey();
    spawnHazards();
    gameRunning = true;
    bestScoreAtRunStart = best.score;
    beatBestThisRun = false;
    startMusic();
    updateHud();
    recordProgress();
  }

  function nextLevel() {
    level++;
    gaps.forEach(g => { g.filled = false; });
    lifeTime = LIFE_TIME_MAX;
    resetMonkey();
    spawnHazards();
    updateHud();
    recordProgress();
  }

  const INTRO_MS = 6100; // how long the "Let's go bananas!" screen shows
  function showIntro(callback) {
    const overlay = document.getElementById('introOverlay');
    overlay.classList.remove('hidden');
    setTimeout(() => {
      overlay.classList.add('hidden');
      callback();
    }, INTRO_MS);
  }

  // Non-blocking celebration: plays a chime and pops a small self-dismissing
  // toast (CSS-animated, cleaned up on 'animationend' below) without ever
  // pausing gameRunning, so there's no shared timing state that could leave
  // the screen stuck.
  function celebrateLevelClear(clearedLevel) {
    sfxLevel();
    sfxApeCall(1, 0.45);
    const overlay = document.getElementById('levelClearOverlay');
    document.getElementById('levelClearTitle').textContent = `Level ${clearedLevel} Clear!`;
    overlay.classList.remove('hidden', 'toast-anim');
    void overlay.offsetWidth; // restart the animation on repeat level-clears
    overlay.classList.add('toast-anim');
  }

  // A hit starts a short death beat: the player freezes where it was hit
  // with X eyes while the life-lost sound plays. The countdown runs inside
  // loop() (not a setTimeout), and hazard/timer checks are skipped during
  // it, so nothing can double-fire. finishDeath() then respawns or ends the
  // run, which means the game-over screen waits until you've seen the hit.
  function loseLife() {
    lives--;
    sfxLifeLost();
    updateHud();
    monkey.dead = true;
    deathTimer = DEATH_PAUSE;
  }

  function finishDeath() {
    if (lives <= 0) {
      gameOver();
    } else {
      lifeTime = LIFE_TIME_MAX;
      resetMonkey();
    }
  }

  function gameOver() {
    gameRunning = false;
    stopMusic();
    sfxGameOver();
    document.getElementById('finalScore').textContent = `Score: ${score} — reached level ${level}`;
    document.getElementById('newBestMsg').classList.toggle('hidden', !beatBestThisRun);
    document.getElementById('gameOverOverlay').classList.remove('hidden');
  }

  // --- movement ---
  function tryMove(dirName) {
    if (!gameRunning || moveLock || monkey.dead) return;
    const d = DIRS[dirName];
    if (!d) return;
    // Rows stay discrete hops, but a left/right step is one sprite width,
    // not one column: columns stretch up to MAX_CELL_W_RATIO × SPRITE on
    // wide boards, and a full-column step there was a big jump. So
    // monkey.col can be fractional in the lanes; it snaps to the nearest
    // whole column when hopping into the goal row, where gaps and gorillas
    // sit on exact columns.
    let nc = monkey.col;
    if (d.dc) {
      const step = Math.min(1, SPRITE / CELL_W);
      nc = Math.min(COLS - 1, Math.max(0, monkey.col + d.dc * step));
      if (Math.abs(nc - Math.round(nc)) < 1e-6) nc = Math.round(nc); // no float drift
      if (nc === monkey.col) return;
    }
    const nr = monkey.row + d.dr;
    if (nr < 0 || nr >= ROWS) return;
    if (nr === 0) {
      nc = Math.round(nc);
      if (GORILLA_COLS.includes(nc)) return;
      const gap = gaps.find(g => g.col === nc);
      if (gap && gap.filled) return;
    }
    moveLock = true;
    monkey.animFrom = { col: monkey.col, row: monkey.row };
    monkey.animTo = { col: nc, row: nr };
    monkey.animT = 0;
    // Scale the tween by the pixels actually covered (in SPRITE widths) so
    // on-screen speed is constant however CELL_W/CELL_H are stretched.
    const hopPx = Math.hypot((nc - monkey.col) * CELL_W, (nr - monkey.row) * CELL_H);
    monkey.animDuration = ANIM_DURATION * Math.max(1, hopPx / SPRITE);
    sfxHop();
  }

  function finishMove() {
    monkey.col = monkey.animTo.col;
    monkey.row = monkey.animTo.row;
    moveLock = false;
    if (monkey.row === 0) {
      const gap = gaps.find(g => g.col === monkey.col);
      if (gap && !gap.filled) {
        gap.filled = true;
        score += 50;
        sfxScore();
        sfxOohOoh(0.2);
        updateHud();
        recordProgress();
        if (gaps.every(g => g.filled)) {
          celebrateLevelClear(level);
          nextLevel();
        } else {
          lifeTime = LIFE_TIME_MAX;
          resetMonkey();
        }
      }
    }
  }

  // --- hazards ---
  function updateHazards(dt) {
    const colsPerSprite = SPRITE / CELL_W;
    for (const h of hazards) {
      if (h.type === 'poop') {
        h.y += h.speed * dt;
        continue;
      }
      h.x += h.dir * h.speed * colsPerSprite * dt;
      if (h.dir > 0 && h.x - h.radius > COLS) h.x = -h.radius;
      if (h.dir < 0 && h.x + h.radius < 0) h.x = COLS + h.radius;
    }
    hazards = hazards.filter(h => h.type !== 'poop' || h.y < POOP_LAND_Y);
    updateGorillas(dt);
    updateBoss(dt);
  }

  function currentMonkeyPos() {
    const t = monkey.animT;
    return {
      col: monkey.animFrom.col + (monkey.animTo.col - monkey.animFrom.col) * t,
      row: monkey.animFrom.row + (monkey.animTo.row - monkey.animFrom.row) * t,
    };
  }

  function hazardHit() {
    const pos = currentMonkeyPos();
    const row = Math.round(pos.row);
    for (const h of hazards) {
      if (h.type === 'poop') {
        const dx = (h.x - pos.col) * CELL_W;
        const dy = (h.y - pos.row) * CELL_H;
        if (Math.hypot(dx, dy) < (h.radius + MONKEY_RADIUS) * SPRITE) return true;
        continue;
      }
      if (h.row !== row) continue;
      const dxPx = Math.abs(h.x - pos.col) * CELL_W;
      if (dxPx < (h.radius + MONKEY_RADIUS) * SPRITE) return true;
    }
    return false;
  }

  // --- input ---
  window.addEventListener('keydown', (e) => {
    // Enter / Space presses Play or Play Again when that screen is showing.
    if (e.code === 'Enter' || e.code === 'Space') {
      const screenBtn = !document.getElementById('startOverlay').classList.contains('hidden')
        ? document.getElementById('startBtn')
        : !document.getElementById('gameOverOverlay').classList.contains('hidden')
          ? document.getElementById('restartBtn')
          : null;
      if (screenBtn) {
        e.preventDefault();
        screenBtn.click();
        return;
      }
    }
    const dir = keyMap[e.code];
    if (!dir) return;
    e.preventDefault();
    ensureAudio();
    tryMove(dir);
  });

  ['up', 'down', 'left', 'right'].forEach(dir => {
    const btn = document.getElementById(`btn-${dir}`);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ensureAudio();
      tryMove(dir);
    });
  });

  document.getElementById('startBtn').addEventListener('click', () => {
    ensureAudio();
    document.getElementById('startOverlay').classList.add('hidden');
    showIntro(() => newRun());
  });
  document.getElementById('restartBtn').addEventListener('click', () => {
    ensureAudio();
    document.getElementById('gameOverOverlay').classList.add('hidden');
    showIntro(() => newRun());
  });
  document.getElementById('musicBtn').addEventListener('click', () => {
    ensureAudio();
    toggleMusic();
  });
  document.getElementById('levelClearOverlay').addEventListener('animationend', (e) => {
    if (e.animationName === 'toastPop') {
      e.currentTarget.classList.add('hidden');
    }
  });

  // --- hud ---
  function updateHud() {
    document.getElementById('score').textContent = score;
    document.getElementById('level').textContent = level;
    renderLives(lives);
  }

  // Remaining lives are tiny copies of the player sprite, rendered once to
  // an image and repeated.
  let lifeIconUrl = null;
  function renderLives(n) {
    if (!lifeIconUrl) {
      const px = 64;
      const icon = document.createElement('canvas');
      icon.width = icon.height = px;
      const size = px * 0.94;
      drawPlushGorilla(icon.getContext('2d'), px / 2, px / 2 + PLUSH_CENTER_Y * size, size, PLAYER_COLORS);
      lifeIconUrl = icon.toDataURL();
    }
    const el = document.getElementById('lives');
    el.innerHTML = `<img class="life-icon" src="${lifeIconUrl}" alt="">`.repeat(Math.max(n, 0)) || '—';
    el.setAttribute('aria-label', `${Math.max(n, 0)} lives`);
  }

  // --- rendering ---
  const wrapEl = document.querySelector('.wrap');
  const dpadEl = document.querySelector('.dpad');

  // Sizes the board to fill the space left after the HUD/timer-bar/d-pad
  // chrome, in both directions. Chrome height is measured live: the gap
  // from the top of .wrap to the bottom of .dpad, minus the canvas's own
  // current height, is everything else regardless of breakpoint or the
  // canvas's previous size. Cells stretch to fill (within the MAX_CELL_*
  // ratios); sprites use SPRITE so they keep their shape.
  function resizeCanvas() {
    const bodyStyle = getComputedStyle(document.body);
    const paddingV = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
    const paddingH = parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);

    const wrapTop = wrapEl.getBoundingClientRect().top;
    const dpadBottom = dpadEl.getBoundingClientRect().bottom;
    const currentCanvasHeight = canvas.getBoundingClientRect().height || 0;
    const chromeHeight = (dpadBottom - wrapTop) - currentCanvasHeight + paddingV;

    const availableHeight = Math.max(200, window.innerHeight - chromeHeight);
    const availableWidth = Math.max(240, window.innerWidth - paddingH);
    const fitW = availableWidth / COLS;
    const fitH = availableHeight / (ROWS + BOSS_BAND_ROWS);
    CELL_W = Math.min(fitW, fitH * MAX_CELL_W_RATIO);
    CELL_H = Math.min(fitH, CELL_W * MAX_CELL_H_RATIO);
    SPRITE = Math.min(CELL_W, CELL_H);

    wrapEl.style.width = `${CELL_W * COLS}px`;
    // Draw at the width the canvas actually rendered at, so any CSS that
    // clamps it shrinks the board instead of squashing the sprites.
    const renderedW = canvas.getBoundingClientRect().width;
    if (renderedW > 0 && Math.abs(renderedW - CELL_W * COLS) > 1) {
      CELL_W = renderedW / COLS;
      CELL_H = Math.min(CELL_H, CELL_W * MAX_CELL_H_RATIO);
      SPRITE = Math.min(CELL_W, CELL_H);
    }
    const width = CELL_W * COLS;
    const height = CELL_H * (ROWS + BOSS_BAND_ROWS);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 100));

  // --- player sprite size and shared drawing helpers ---
  // The player is the plush gorilla (see drawPlushGorilla) in brown, with
  // no hat. Size is visual only; the hit box is MONKEY_RADIUS.
  const playerSize = () => SPRITE * 1.15;
  const CHEST_BEATS_PER_SEC = 4; // per arm; arms alternate, so 8 hits/sec

  function shape(g, points, color) {
    g.beginPath();
    g.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.stroke();
  }

  function ellipseFill(g, x, y, rx, ry, color) {
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  }

  // Two full spins that ease out over the first DEATH_SPIN_TIME seconds of
  // the death pause, ending tipped over (DEATH_TILT) where it stays.
  const DEATH_SPIN_TIME = 0.6;
  const DEATH_TILT = 0.4;
  function deathSpinAngle() {
    const p = Math.min(1, (DEATH_PAUSE - deathTimer) / DEATH_SPIN_TIME);
    const eased = 1 - (1 - p) ** 3;
    return (Math.PI * 4 + DEATH_TILT) * eased;
  }

  // --- boss gorilla sprite ---
  // Modeled on the owner's reference (a Gorilla Tag plush): rounded black
  // body, grey ears/face/chest, big white eyes with black rims, long arms
  // stretched out to the sides, and a rainbow zig-zag party hat. He holds a
  // poop in his left hand. Drawn smooth (ellipses and round strokes) rather
  // than faceted, because the reference is a plush.
  const BOSS_COLORS = {
    fur: '#26272b',
    furLight: '#3b3d43',
    furDark: '#151619',
    face: '#8f9197',
    faceLight: '#aeb0b5',
    earInner: '#6c6e74',
    ink: '#0b0b0c',
  };
  const PARTY_HAT_STRIPES = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ec407a'];

  const lerp = (a, b, t) => a + (b - a) * t;

  function drawPartyHat(g) {
    g.save();
    g.translate(0.01, -0.48);
    g.rotate(0.12);
    const w = 0.13;
    const h = 0.42;
    g.beginPath();
    g.moveTo(-w, 0); g.lineTo(w, 0); g.lineTo(0.02, -h); g.closePath();
    g.save();
    g.clip();
    const band = h / PARTY_HAT_STRIPES.length;
    PARTY_HAT_STRIPES.forEach((color, i) => {
      // each stripe's top edge is a zig-zag, like the reference hat
      const y0 = -i * band + 0.01;
      const y1 = -(i + 1) * band;
      g.beginPath();
      g.moveTo(-0.2, y0);
      g.lineTo(0.2, y0);
      for (let x = 0.2, up = true; x >= -0.2; x -= 0.035, up = !up) g.lineTo(x, y1 + (up ? -0.014 : 0.014));
      g.closePath();
      g.fillStyle = color;
      g.fill();
    });
    g.restore();
    g.beginPath();
    g.moveTo(-w, 0); g.lineTo(w, 0); g.lineTo(0.02, -h); g.closePath();
    g.lineWidth = 0.012;
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.stroke();
    g.restore();
  }

  // raise: 0..1 how far the throwing (left) arm is lifted overhead.
  // holding: draw the poop in his raised/left hand. sway: waddle tilt.
  function drawBoss(g, cx, cy, size, { raise = 0, holding = true, sway = 0 } = {}) {
    const c = BOSS_COLORS;
    const e = raise * raise * (3 - 2 * raise); // smoothstep
    const leftElbow = [lerp(-0.55, -0.42, e), lerp(0.12, -0.28, e)];
    const leftHand = [lerp(-0.92, BOSS_HAND_UP[0], e), lerp(0.22, BOSS_HAND_UP[1], e)];
    g.save();
    g.translate(cx, cy);
    g.rotate(sway);
    g.scale(size, size);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // long plush arms stretched out to the sides, behind the body
    for (const [elbow, hand, sx] of [[leftElbow, leftHand, -1], [[0.55, 0.12], [0.92, 0.22], 1]]) {
      g.beginPath();
      g.moveTo(sx * 0.17, 0);
      g.lineTo(elbow[0], elbow[1]);
      g.lineTo(hand[0], hand[1]);
      g.strokeStyle = c.fur;
      g.lineWidth = 0.15;
      g.stroke();
      g.strokeStyle = c.furLight; // soft highlight along the top of the arm
      g.lineWidth = 0.035;
      g.beginPath();
      g.moveTo(sx * 0.2, -0.04);
      g.lineTo(elbow[0], elbow[1] - 0.045);
      g.stroke();
      ellipseFill(g, hand[0], hand[1], 0.085, 0.065, c.furDark);
    }

    // body with chest patch
    ellipseFill(g, 0, 0.13, 0.25, 0.25, c.fur);
    ellipseFill(g, -0.07, 0.06, 0.1, 0.12, c.furLight);
    ellipseFill(g, 0, 0.15, 0.12, 0.16, c.face);

    // ears, head, face mask
    for (const sx of [-1, 1]) {
      ellipseFill(g, sx * 0.24, -0.3, 0.075, 0.075, c.face);
      ellipseFill(g, sx * 0.245, -0.3, 0.04, 0.04, c.earInner);
    }
    ellipseFill(g, 0, -0.3, 0.25, 0.23, c.fur);
    for (const sx of [-1, 1]) ellipseFill(g, sx * 0.09, -0.32, 0.098, 0.095, c.face);
    ellipseFill(g, 0, -0.2, 0.13, 0.1, c.face);
    ellipseFill(g, 0, -0.19, 0.1, 0.07, c.faceLight);

    // brows sit on top of the eye rims, never over the eyes
    for (const sx of [-1, 1]) {
      shape(g, [sx * 0.19, -0.43, sx * 0.02, -0.41, sx * 0.02, -0.392, sx * 0.18, -0.405], c.ink);
    }
    // big white eyes with black rims and pupils
    for (const sx of [-1, 1]) {
      ellipseFill(g, sx * 0.09, -0.32, 0.07, 0.065, c.ink);
      ellipseFill(g, sx * 0.09, -0.32, 0.056, 0.051, '#ffffff');
      ellipseFill(g, sx * 0.082, -0.315, 0.027, 0.027, c.ink);
      ellipseFill(g, sx * 0.082 - 0.009, -0.325, 0.008, 0.008, '#ffffff');
    }
    // nose and mouth
    for (const sx of [-1, 1]) ellipseFill(g, sx * 0.03, -0.21, 0.016, 0.011, c.ink);
    g.beginPath();
    g.moveTo(-0.06, -0.15);
    g.quadraticCurveTo(0, -0.13, 0.06, -0.15);
    g.strokeStyle = c.ink;
    g.lineWidth = 0.015;
    g.stroke();

    drawPartyHat(g);

    if (holding) {
      // back to pixel scale at the hand so the emoji renders at a normal font size
      g.save();
      g.translate(leftHand[0], leftHand[1] - 0.05);
      g.scale(1 / size, 1 / size);
      g.font = `${size * 0.24}px ${EMOJI_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.fillText('💩', 0, 0);
      g.restore();
    }
    g.restore();
  }

  // --- plush gorillas: the three in the goal row, and the player ---
  // Modeled on the owner's second plush reference: a sitting plush with
  // pale ears, face and chest, a long nose ridge, eyes outlined in
  // light-blue stitching, a stitched mouth, and arms resting down in front
  // with the hands on the ground. The goal-row gorillas are black with a
  // tall top hat (HAT_PLUSH_COLORS, `hat: true`); the player is the same
  // plush in brown with no hat (PLAYER_COLORS). Smooth like the boss, since
  // it's a plush. Drawn in a unit box around (cx, cy), scaled by size; the
  // body spans about y -0.53 (head) to 0.46 (hands). Options:
  //   beat  seconds into a chest-beat, or -1. The fists alternate onto the
  //         chest, the mouth opens, and the hat bounces.
  //   hop   0..1 jump progress: lifts the body and tucks the hands up
  //         mid-hop (1 = sitting).
  //   dead  X eyes and an "o" mouth (player after a hit).
  //   angle rotation in radians (death spin, splash dance).
  //   hat   draw the top hat.
  const HAT_PLUSH_COLORS = {
    fur: '#1f2024',
    furLight: '#34363b',
    furDark: '#121315',
    face: '#6f727a',
    faceLight: '#858891',
    stitch: '#a9d9e2',
    eye: '#eef6f7',
    ink: '#0b0b0c',
    hat: '#0e0e10',
    hatLight: '#2a2b31',
    band: '#8d9097',
  };
  const PLAYER_COLORS = {
    fur: '#6b4426',
    furLight: '#8a5b35',
    furDark: '#472c17',
    face: '#b98d62',
    faceLight: '#cfa77d',
    stitch: '#a9d9e2',
    eye: '#eef6f7',
    ink: '#1a100a',
  };
  // Shift (in sprite units) that centers the plush's head-to-hands span on a point.
  const PLUSH_CENTER_Y = 0.035;

  function drawPlushGorilla(g, cx, cy, size, c, { beat = -1, hop = 1, dead = false, angle = 0, hat = false } = {}) {
    const beating = beat >= 0;
    const lift = dead ? 0 : Math.sin(hop * Math.PI);
    const bob = beating ? Math.abs(Math.sin(beat * Math.PI * 2 * CHEST_BEATS_PER_SEC)) * 0.03 : 0;
    g.save();
    g.translate(cx, cy - (lift * 0.08 + bob) * size);
    if (angle) g.rotate(angle);
    g.scale(size, size);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // body and chest patch
    ellipseFill(g, 0, 0.14, 0.27, 0.26, c.fur);
    ellipseFill(g, -0.08, 0.07, 0.1, 0.12, c.furLight);
    ellipseFill(g, 0, 0.16, 0.11, 0.14, c.face);

    // arms: resting down in front with hands on the ground, or chest-beating
    for (const sx of [-1, 1]) {
      let hand;
      if (beating) {
        const phase = beat * Math.PI * 2 * CHEST_BEATS_PER_SEC + (sx < 0 ? 0 : Math.PI);
        const v = 0.5 + 0.5 * Math.sin(phase); // 1 = fist on the chest
        hand = [sx * lerp(0.34, 0.08, v), lerp(-0.1, 0.12, v)];
      } else {
        hand = [sx * (0.2 + lift * 0.08), 0.38 - lift * 0.14];
      }
      g.beginPath();
      g.moveTo(sx * 0.22, -0.02);
      g.quadraticCurveTo(sx * 0.3, 0.16, hand[0], hand[1]);
      g.strokeStyle = c.fur;
      g.lineWidth = 0.15;
      g.stroke();
      ellipseFill(g, hand[0], hand[1] + 0.02, 0.085, 0.06, c.furDark);
    }

    // ears and head
    for (const sx of [-1, 1]) {
      ellipseFill(g, sx * 0.25, -0.3, 0.07, 0.07, c.face);
      ellipseFill(g, sx * 0.255, -0.3, 0.037, 0.037, c.furDark);
    }
    ellipseFill(g, 0, -0.3, 0.25, 0.23, c.fur);

    // face mask: eye patches, a long nose ridge, and the muzzle
    for (const sx of [-1, 1]) ellipseFill(g, sx * 0.09, -0.33, 0.095, 0.075, c.face);
    ellipseFill(g, 0, -0.22, 0.055, 0.11, c.face);
    ellipseFill(g, 0, -0.14, 0.085, 0.055, c.faceLight);

    // eyes: pale, outlined in light-blue stitching, black pupils
    for (const sx of [-1, 1]) {
      g.save();
      g.translate(sx * 0.09, -0.33);
      g.rotate(sx * 0.18); // slight scowl
      ellipseFill(g, 0, 0, 0.058, 0.036, c.eye);
      g.beginPath();
      g.ellipse(0, 0, 0.058, 0.036, 0, 0, Math.PI * 2);
      g.strokeStyle = c.stitch;
      g.lineWidth = 0.014;
      g.stroke();
      if (dead) {
        g.beginPath();
        g.moveTo(-0.024, -0.024); g.lineTo(0.024, 0.024);
        g.moveTo(0.024, -0.024); g.lineTo(-0.024, 0.024);
        g.strokeStyle = c.ink;
        g.lineWidth = 0.02;
        g.stroke();
      } else {
        ellipseFill(g, -sx * 0.008, 0.004, 0.02, 0.02, c.ink);
      }
      g.restore();
    }

    // nostrils and a stitched "w" mouth (open while chest-beating)
    for (const sx of [-1, 1]) ellipseFill(g, sx * 0.022, -0.165, 0.013, 0.009, c.ink);
    if (dead) {
      ellipseFill(g, 0, -0.12, 0.022, 0.022, c.ink);
    } else if (beating) {
      ellipseFill(g, 0, -0.12, 0.045, 0.028, c.ink);
    } else {
      g.beginPath();
      g.moveTo(-0.04, -0.125);
      g.quadraticCurveTo(-0.02, -0.105, 0, -0.12);
      g.quadraticCurveTo(0.02, -0.105, 0.04, -0.125);
      g.strokeStyle = c.stitch;
      g.lineWidth = 0.012;
      g.stroke();
    }

    // tall top hat with a grey band; a faint rim keeps it readable on black
    if (hat) {
      g.save();
      g.translate(0, -0.47 - bob * 2.5);
      g.rotate(-0.06);
      g.lineWidth = 0.014;
      g.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      shape(g, [-0.15, 0, 0, 0, 0, -0.36, -0.14, -0.36], c.hatLight);
      shape(g, [0, 0, 0.15, 0, 0.14, -0.36, 0, -0.36], c.hat);
      shape(g, [-0.15, -0.02, 0.15, -0.02, 0.15, -0.055, -0.15, -0.055], c.band);
      shape(g, [-0.27, -0.015, 0.27, -0.015, 0.28, 0.025, -0.28, 0.025], c.hat); // brim
      g.restore();
    }

    g.restore();
  }

  // --- thrown stick hazard ---
  // Modeled on the owner's reference: a low-poly brown stick, flat-shaded
  // (a lit and a shadowed half on each segment), with a short bent fork to
  // one side and a longer one pointing up near the top. Drawn in a unit box
  // around (cx, cy), scaled by size and rotated by angle. The hit box is
  // still the lane's round radius.
  const STICK_COLORS = { light: '#86603a', dark: '#4a3019', end: '#a57c52' };

  // A tapered two-tone segment from (x0, y0) (width w0) to (x1, y1) (width w1).
  function stickSegment(g, x0, y0, x1, y1, w0, w1) {
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    shape(g, [x0 + nx * w0 / 2, y0 + ny * w0 / 2, x1 + nx * w1 / 2, y1 + ny * w1 / 2, x1, y1, x0, y0], STICK_COLORS.light);
    shape(g, [x0, y0, x1, y1, x1 - nx * w1 / 2, y1 - ny * w1 / 2, x0 - nx * w0 / 2, y0 - ny * w0 / 2], STICK_COLORS.dark);
  }

  function drawStick(g, cx, cy, size, angle) {
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    g.scale(size, size);
    g.lineJoin = 'round';
    g.lineWidth = 0.02;
    g.strokeStyle = 'rgba(20, 10, 0, 0.55)';
    // forks first so the main shaft covers their joints
    stickSegment(g, -0.12, -0.2, -0.38, -0.2, 0.05, 0.04); // short side fork...
    stickSegment(g, -0.38, -0.2, -0.45, -0.14, 0.04, 0.035); // ...with a bent tip
    stickSegment(g, 0.04, -0.04, 0.1, -0.24, 0.055, 0.045); // upright fork
    stickSegment(g, 0.1, -0.24, 0.13, -0.4, 0.045, 0.035);
    stickSegment(g, 0.42, 0.46, 0.04, -0.02, 0.1, 0.08); // main shaft
    stickSegment(g, 0.04, -0.02, -0.34, -0.46, 0.08, 0.06);
    ellipseFill(g, 0.42, 0.46, 0.045, 0.03, STICK_COLORS.end); // cut end
    g.restore();
  }

  // The branch the boss walks on, in the band above the goal row. The band's
  // own background is the jungle photo (drawn by draw() before this runs);
  // this just adds the branch and leaf clusters on top of it.
  function drawBossBand(width, bandH) {
    const branchY = bandH - 0.1 * CELL_H;
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(0, branchY - 0.03 * CELL_H, width, 0.08 * CELL_H);
    ctx.fillStyle = '#6f4a27';
    ctx.fillRect(0, branchY - 0.03 * CELL_H, width, 0.025 * CELL_H);
    const leaves = COLS * 2;
    for (let i = 0; i < leaves; i++) {
      ctx.save();
      ctx.translate(((i + 0.5) / leaves) * width, branchY + 0.05 * CELL_H);
      ctx.rotate(i % 2 ? 0.5 : -0.5);
      ctx.beginPath();
      ctx.ellipse(0, 0.05 * CELL_H, SPRITE * 0.12, SPRITE * 0.045, 0, 0, Math.PI * 2);
      ctx.fillStyle = i % 3 ? '#2f6b35' : '#3c8443';
      ctx.fill();
      ctx.restore();
    }
  }

  function draw() {
    const width = CELL_W * COLS;
    const bandH = BOSS_BAND_ROWS * CELL_H;
    const totalH = bandH + CELL_H * ROWS;
    ctx.clearRect(0, 0, width, totalH);
    if (bgLoaded) drawImageCover(ctx, bgImage, 0, 0, width, totalH);
    drawBossBand(width, bandH);

    // Everything below is in grid space: row 0 starts at y = 0, and the
    // boss band sits at negative y above it.
    ctx.save();
    ctx.translate(0, bandH);

    laneDefs.forEach((lane, row) => {
      ctx.fillStyle = LANE_COLORS[lane.type];
      ctx.fillRect(0, row * CELL_H, width, CELL_H);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(0, (row + 1) * CELL_H);
      ctx.lineTo(width, (row + 1) * CELL_H);
      ctx.stroke();
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';

    // enemy gorillas; a shaking gorilla is chest-beating before its drop
    GORILLA_COLS.forEach(col => {
      const beat = gorillaShake[col] > 0 ? GORILLA_SHAKE_TIME - gorillaShake[col] : -1;
      // A bit bigger than the player; hands rest on the bottom of row 0 and
      // the hat pokes up into the boss band.
      const size = SPRITE * 1.375;
      drawPlushGorilla(ctx, (col + 0.5) * CELL_W, CELL_H - 0.46 * size, size, HAT_PLUSH_COLORS, { beat, hat: true });
    });

    // gaps
    gaps.forEach(g => {
      const cx = (g.col + 0.5) * CELL_W;
      const cy = 0.5 * CELL_H;
      if (g.filled) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(g.col * CELL_W, 0, CELL_W, CELL_H);
        // Emoji glyphs inherit fillStyle's alpha, so reset to opaque before
        // any fillText or everything drawn after this comes out faded.
        ctx.fillStyle = '#fff';
        const size = playerSize() * 0.9;
        drawPlushGorilla(ctx, cx, cy + PLUSH_CENTER_Y * size, size, PLAYER_COLORS);
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, SPRITE * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // boss: waddles while walking, stands still to wind up the throw
    const walkT = performance.now() / 1000;
    const walking = boss.windup <= 0 && gameRunning;
    drawBoss(ctx, bossCenterX(), bossCenterY() - (walking ? Math.abs(Math.sin(walkT * 8)) * 0.03 * bossSize() : 0), bossSize(), {
      raise: boss.windup > 0 ? 1 - boss.windup / BOSS_WINDUP : 0,
      holding: boss.reload <= 0,
      sway: walking ? Math.sin(walkT * 8) * 0.06 : 0,
    });
    ctx.fillStyle = '#fff'; // opaque again before emoji hazards

    // hazards
    const HAZARD_EMOJI = { poop: '💩' };
    hazards.forEach(h => {
      const rowPos = h.type === 'poop' ? h.y : h.row;
      const hx = (h.x + 0.5) * CELL_W;
      const hy = (rowPos + 0.5) * CELL_H;
      if (h.type === 'stick') {
        // tumbles end over end: spin follows distance travelled, in sprite widths
        drawStick(ctx, hx, hy, h.radius * 2.6 * SPRITE, h.x * (CELL_W / SPRITE) * 1.3 * h.dir);
        return;
      }
      if (h.type === 'banana') {
        drawBanana(ctx, hx, hy, h.radius * 2 * BANANA_DRAW_SCALE * SPRITE, h.dir, h.angle);
        return;
      }
      // Drawn size only; POOP_DRAW_SCALE doesn't touch h.radius, which is
      // still what hazardHit() uses, so this is visual-only and doesn't
      // change the hit box.
      const drawScale = h.type === 'poop' ? POOP_DRAW_SCALE : 1;
      ctx.font = `${h.radius * 2 * drawScale * SPRITE}px ${EMOJI_FONT}`;
      ctx.fillText(HAZARD_EMOJI[h.type], hx, hy);
    });

    // monkey
    const pos = currentMonkeyPos();
    drawPlushGorilla(ctx, (pos.col + 0.5) * CELL_W, (pos.row + 0.5) * CELL_H + PLUSH_CENTER_Y * playerSize(), playerSize(), PLAYER_COLORS, {
      // sideways steps slide flat; only row changes bounce
      hop: monkey.animFrom.row !== monkey.animTo.row ? monkey.animT : 1,
      dead: monkey.dead,
      angle: monkey.dead ? deathSpinAngle() : 0,
    });
    ctx.restore();
  }

  // --- player gorilla scenes: splash/intro dance and the game-over
  // knockout, all drawn with the same drawPlushGorilla() as in-game so
  // they always match. Eyes are never covered. Each scene is a square
  // canvas that re-measures itself after a resize (or the first time its
  // overlay is visible) and only draws while that overlay is showing.
  function makeScene(canvasId, overlayId, drawFn) {
    const canvas = document.getElementById(canvasId);
    const overlay = document.getElementById(overlayId);
    const g = canvas.getContext('2d');
    let size = 0;
    window.addEventListener('resize', () => { size = 0; }); // re-measure next frame
    return ms => {
      if (overlay.classList.contains('hidden')) return;
      if (!size) {
        const cssSize = canvas.getBoundingClientRect().width;
        if (!cssSize) return;
        const dpr = window.devicePixelRatio || 1;
        size = cssSize;
        canvas.width = canvas.height = Math.round(cssSize * dpr);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      drawFn(g, size, ms);
    };
  }

  // One DANCE_PERIOD loop: bounce-and-sway groove, a chest-beat, then a
  // hop-spin that lands facing front again.
  const DANCE_PERIOD = 4.2;
  function drawDancer(g, s, ms) {
    const t = (ms / 1000) % DANCE_PERIOD;
    let hop = 1;
    let beat = -1;
    let angle = 0;
    if (t < 2.4) {
      hop = (t * 2) % 1; // two bounces a second
      angle = Math.sin(t * Math.PI * 2) * 0.14; // sway
    } else if (t < 3.4) {
      beat = t - 2.4;
    } else {
      const p = (t - 3.4) / (DANCE_PERIOD - 3.4);
      hop = p;
      angle = Math.PI * 2 * (1 - (1 - p) ** 2);
    }

    const size = s * 0.8;
    const lift = Math.sin(hop * Math.PI);
    g.clearRect(0, 0, s, s);
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.ellipse(s / 2, s * 0.9, s * (0.2 - lift * 0.05), s * 0.035, 0, 0, Math.PI * 2);
    g.fill(); // shadow shrinks as he jumps
    drawPlushGorilla(g, s / 2, s * 0.88 - 0.46 * size, size, PLAYER_COLORS, { hop, beat, angle });
  }
  const drawSplashDancer = makeScene('splashDancer', 'startOverlay', drawDancer);
  const drawIntroDancer = makeScene('introDancer', 'introOverlay', drawDancer);

  // Game-over: the player lying dazed, tipped at the death-spin's resting
  // angle (DEATH_TILT) with a slow woozy sway layered on top; no hop, since
  // drawPlushGorilla forces lift to 0 while dead.
  function drawKnockedOut(g, s, ms) {
    const size = s * 0.8;
    const angle = DEATH_TILT + Math.sin(ms / 1000 * 1.1) * 0.05;
    g.clearRect(0, 0, s, s);
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.ellipse(s / 2, s * 0.9, s * 0.2, s * 0.035, 0, 0, Math.PI * 2);
    g.fill();
    drawPlushGorilla(g, s / 2, s * 0.88 - 0.46 * size, size, PLAYER_COLORS, { dead: true, angle });
  }
  const drawGameOverDancer = makeScene('gameOverDancer', 'gameOverOverlay', drawKnockedOut);

  // --- main loop ---
  function loop(t) {
    const dt = Math.min((t - lastTime) / 1000, 0.05) || 0;
    lastTime = t;

    if (gameRunning) {
      updateHazards(dt);

      if (deathTimer > 0) {
        deathTimer -= dt;
        if (deathTimer <= 0) finishDeath();
      } else {
        if (moveLock) {
          monkey.animT += (dt * 1000) / monkey.animDuration;
          if (monkey.animT >= 1) {
            monkey.animT = 1;
            finishMove();
          }
        }

        lifeTime -= dt;
        document.getElementById('timerbar').style.width = `${Math.max(lifeTime / LIFE_TIME_MAX, 0) * 100}%`;

        const hit = (!moveLock && hazardHit()) || lifeTime <= 0;
        if (hit) loseLife();
      }
    }

    draw();
    drawSplashDancer(t);
    drawIntroDancer(t);
    drawGameOverDancer(t);
    requestAnimationFrame(loop);
  }

  updateBestDisplay();
  resizeCanvas();
  resetMonkey();
  spawnHazards();
  renderLives(3);
  draw();
  requestAnimationFrame(loop);
})();
