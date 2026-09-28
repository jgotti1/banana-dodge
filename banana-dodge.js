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
  const POOP_RADIUS = 0.24; // sprite units
  const POOP_FALL_SPEED = 2.6; // rows per second at level 1
  const POOP_LAND_Y = ROWS - 1.5; // row-center coords: top edge of start row
  const GORILLA_SHAKE_TIME = 0.7; // seconds of warning before the drop
  const DROP_INTERVAL_MIN = 2.5;
  const DROP_INTERVAL_MAX = 6;

  const EMOJI_FONT = 'Apple Color Emoji, "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

  // Row 0 = goal (top), row 8 = start (bottom).
  const laneDefs = [
    { type: 'goal' },
    { type: 'safe' },
    { type: 'banana', dir: 1, baseSpeed: 1.4, count: 3, radius: 0.22 },
    { type: 'barrel', dir: -1, baseSpeed: 1.1, count: 2, radius: 0.34 },
    { type: 'safe' },
    { type: 'banana', dir: -1, baseSpeed: 1.7, count: 4, radius: 0.22 },
    { type: 'barrel', dir: 1, baseSpeed: 1.3, count: 2, radius: 0.34 },
    { type: 'safe' },
    { type: 'start' },
  ];

  const LANE_COLORS = {
    goal: '#14321a',
    start: '#2e5b2e',
    safe: '#3a6b3a',
    banana: '#4a3a1a',
    barrel: '#4a2a1a',
  };

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
  const MAX_CELL_H_RATIO = 1.5;
  let hazards = [];
  let gorillaShake = {}; // gorilla col -> seconds of shaking left
  let nextDropIn = 0;
  const gaps = GAP_COLS.map(col => ({ col, filled: false }));
  let monkey, moveLock, level, score, lives, lifeTime, gameRunning;
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
  const sfxHit = () => beep(160, 0.25, 'sawtooth', 0.07);
  const sfxGrumble = () => { beep(110, 0.35, 'sawtooth', 0.035); beep(95, 0.35, 'sawtooth', 0.03, 0.12); };
  const sfxPlop = () => { beep(420, 0.06, 'sine', 0.06); beep(210, 0.12, 'sine', 0.06, 0.05); };
  const sfxHighScore = () => [784, 988, 1175, 1568, 1976].forEach((f, i) => beep(f, 0.14, 'triangle', 0.06, i * 0.08));
  const sfxLevel = () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.12, 'triangle', 0.06, i * 0.1));
  const sfxGameOver = () => {
    [400, 300, 200, 150].forEach((f, i) => beep(f, 0.22, 'sawtooth', 0.07, i * 0.18));
    beep(90, 0.6, 'sawtooth', 0.08, 4 * 0.18); // final low "womp" for a sad-trombone finish
  };

  // --- audio: looping "fun monkey" background music ---
  // Bouncy marimba-style pentatonic riff with a light bongo thump, all synthesized (no audio files).
  const MUSIC_SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]; // C D E G A C
  const MUSIC_PATTERN = [0, 2, 4, 2, 3, 5, 3, 2, 0, 4, 2, 4, 3, 5, 4, 2];
  const NOTE_MS = 220;
  let musicIndex = 0;
  let musicTimer = null;
  let musicEnabled = true;

  function playMusicStep() {
    if (!musicEnabled || !audioCtx) return;
    const step = musicIndex % MUSIC_PATTERN.length;
    const freq = MUSIC_SCALE[MUSIC_PATTERN[step]];
    const accent = step % 4 === 0;
    beep(freq, 0.18, 'triangle', accent ? 0.05 : 0.032);
    if (step % 2 === 0) beep(110, 0.06, 'sine', 0.02); // bongo thump on the downbeat
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
      if (lane.type !== 'banana' && lane.type !== 'barrel') return;
      const count = Math.max(lane.count, Math.round(lane.count * stretch));
      for (let i = 0; i < count; i++) {
        hazards.push({
          row,
          type: lane.type,
          dir: lane.dir,
          radius: lane.radius,
          speed: lane.baseSpeed * speedMul(), // sprite widths per second
          x: ((COLS / count) * i + row * 0.4) % COLS,
        });
      }
    });
    gorillaShake = {};
    nextDropIn = randomDropInterval();
  }

  function randomDropInterval() {
    return DROP_INTERVAL_MIN + Math.random() * (DROP_INTERVAL_MAX - DROP_INTERVAL_MIN);
  }

  // Poop lives in the same `hazards` array as bananas/barrels (type 'poop'),
  // but moves vertically: x is its column, y is its row-center position.
  function updateGorillas(dt) {
    nextDropIn -= dt;
    if (nextDropIn <= 0) {
      const idle = GORILLA_COLS.filter(col => !(gorillaShake[col] > 0));
      if (idle.length) {
        gorillaShake[idle[Math.floor(Math.random() * idle.length)]] = GORILLA_SHAKE_TIME;
        sfxGrumble();
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
    };
    moveLock = false;
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

  function showIntro(callback) {
    const overlay = document.getElementById('introOverlay');
    overlay.classList.remove('hidden');
    setTimeout(() => {
      overlay.classList.add('hidden');
      callback();
    }, 1100);
  }

  // Non-blocking celebration: plays a chime and pops a small self-dismissing
  // toast (CSS-animated, cleaned up on 'animationend' below) without ever
  // pausing gameRunning, so there's no shared timing state that could leave
  // the screen stuck.
  function celebrateLevelClear(clearedLevel) {
    sfxLevel();
    const overlay = document.getElementById('levelClearOverlay');
    document.getElementById('levelClearTitle').textContent = `Level ${clearedLevel} Clear!`;
    overlay.classList.remove('hidden', 'toast-anim');
    void overlay.offsetWidth; // restart the animation on repeat level-clears
    overlay.classList.add('toast-anim');
  }

  function loseLife() {
    lives--;
    sfxHit();
    updateHud();
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
    if (!gameRunning || moveLock) return;
    const d = DIRS[dirName];
    if (!d) return;
    const nc = monkey.col + d.dc;
    const nr = monkey.row + d.dr;
    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return;
    if (nr === 0) {
      if (GORILLA_COLS.includes(nc)) return;
      const gap = gaps.find(g => g.col === nc);
      if (gap && gap.filled) return;
    }
    moveLock = true;
    monkey.animFrom = { col: monkey.col, row: monkey.row };
    monkey.animTo = { col: nc, row: nr };
    monkey.animT = 0;
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
    document.getElementById('lives').textContent = '🐒'.repeat(Math.max(lives, 0)) || '—';
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
    const fitH = availableHeight / ROWS;
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
    const height = CELL_H * ROWS;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 100));

  function draw() {
    const width = CELL_W * COLS;
    const height = CELL_H * ROWS;
    ctx.clearRect(0, 0, width, height);

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

    // gorillas
    ctx.font = `${SPRITE * 0.7}px ${EMOJI_FONT}`;
    const now = performance.now();
    GORILLA_COLS.forEach(col => {
      const x = (col + 0.5) * CELL_W;
      const y = 0.5 * CELL_H;
      if (gorillaShake[col] > 0) {
        ctx.save();
        ctx.translate(x + Math.sin(now / 22) * SPRITE * 0.08, y);
        ctx.rotate(Math.sin(now / 35) * 0.12);
        ctx.fillText('🦍', 0, 0);
        ctx.restore();
      } else {
        ctx.fillText('🦍', x, y);
      }
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
        ctx.fillText('🐒', cx, cy);
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

    // hazards
    const HAZARD_EMOJI = { banana: '🍌', barrel: '🛢️', poop: '💩' };
    hazards.forEach(h => {
      ctx.font = `${h.radius * 2 * SPRITE}px ${EMOJI_FONT}`;
      const rowPos = h.type === 'poop' ? h.y : h.row;
      ctx.fillText(HAZARD_EMOJI[h.type], (h.x + 0.5) * CELL_W, (rowPos + 0.5) * CELL_H);
    });

    // monkey
    const pos = currentMonkeyPos();
    ctx.font = `${SPRITE * 0.7}px ${EMOJI_FONT}`;
    ctx.fillText('🐒', (pos.col + 0.5) * CELL_W, (pos.row + 0.5) * CELL_H);
  }

  // --- main loop ---
  function loop(t) {
    const dt = Math.min((t - lastTime) / 1000, 0.05) || 0;
    lastTime = t;

    if (gameRunning) {
      updateHazards(dt);

      if (moveLock) {
        monkey.animT += (dt * 1000) / ANIM_DURATION;
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

    draw();
    requestAnimationFrame(loop);
  }

  updateBestDisplay();
  resizeCanvas();
  resetMonkey();
  spawnHazards();
  draw();
  requestAnimationFrame(loop);
})();
