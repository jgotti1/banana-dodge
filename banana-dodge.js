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

  let CELL = 60;
  let hazards = [];
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
  const sfxLevel = () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.12, 'triangle', 0.06, i * 0.1));
  const sfxGameOver = () => [400, 300, 200, 100].forEach((f, i) => beep(f, 0.2, 'sawtooth', 0.06, i * 0.15));

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

  function toggleMusic() {
    musicEnabled = !musicEnabled;
    document.getElementById('musicBtn').textContent = musicEnabled ? '🎵' : '🔇';
  }

  // --- level / hazard setup ---
  function speedMul() {
    return 1 + (level - 1) * 0.22;
  }

  function spawnHazards() {
    hazards = [];
    laneDefs.forEach((lane, row) => {
      if (lane.type !== 'banana' && lane.type !== 'barrel') return;
      for (let i = 0; i < lane.count; i++) {
        hazards.push({
          row,
          type: lane.type,
          dir: lane.dir,
          radius: lane.radius,
          speed: lane.baseSpeed * speedMul(),
          x: ((COLS / lane.count) * i + row * 0.4) % COLS,
        });
      }
    });
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
    updateHud();
  }

  function nextLevel() {
    level++;
    gaps.forEach(g => { g.filled = false; });
    lifeTime = LIFE_TIME_MAX;
    resetMonkey();
    spawnHazards();
    updateHud();
  }

  function showIntro(callback) {
    const overlay = document.getElementById('introOverlay');
    overlay.classList.remove('hidden');
    setTimeout(() => {
      overlay.classList.add('hidden');
      callback();
    }, 1100);
  }

  function showLevelClear() {
    gameRunning = false;
    sfxLevel();
    const overlay = document.getElementById('levelClearOverlay');
    document.getElementById('levelClearTitle').textContent = `Level ${level} Clear!`;
    overlay.classList.remove('hidden');
    setTimeout(() => {
      overlay.classList.add('hidden');
      nextLevel();
      gameRunning = true;
    }, 1400);
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
    sfxGameOver();
    document.getElementById('finalScore').textContent = `Score: ${score} — reached level ${level}`;
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
        if (gaps.every(g => g.filled)) {
          showLevelClear();
        } else {
          lifeTime = LIFE_TIME_MAX;
          resetMonkey();
        }
      }
    }
  }

  // --- hazards ---
  function updateHazards(dt) {
    for (const h of hazards) {
      h.x += h.dir * h.speed * dt;
      if (h.dir > 0 && h.x - h.radius > COLS) h.x = -h.radius;
      if (h.dir < 0 && h.x + h.radius < 0) h.x = COLS + h.radius;
    }
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
      if (h.row !== row) continue;
      const dx = (h.x + 0.5) - (pos.col + 0.5);
      if (Math.abs(dx) < h.radius + MONKEY_RADIUS) return true;
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

  // --- hud ---
  function updateHud() {
    document.getElementById('score').textContent = score;
    document.getElementById('level').textContent = level;
    document.getElementById('lives').textContent = '🐒'.repeat(Math.max(lives, 0)) || '—';
  }

  // --- rendering ---
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    CELL = width / COLS;
    const height = CELL * ROWS;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas);

  function draw() {
    const width = CELL * COLS;
    const height = CELL * ROWS;
    ctx.clearRect(0, 0, width, height);

    laneDefs.forEach((lane, row) => {
      ctx.fillStyle = LANE_COLORS[lane.type];
      ctx.fillRect(0, row * CELL, width, CELL);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(0, (row + 1) * CELL);
      ctx.lineTo(width, (row + 1) * CELL);
      ctx.stroke();
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // gorillas
    ctx.font = `${CELL * 0.7}px ${EMOJI_FONT}`;
    GORILLA_COLS.forEach(col => {
      ctx.fillText('🦍', (col + 0.5) * CELL, 0.5 * CELL);
    });

    // gaps
    gaps.forEach(g => {
      const cx = (g.col + 0.5) * CELL;
      const cy = 0.5 * CELL;
      if (g.filled) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(g.col * CELL, 0, CELL, CELL);
        ctx.fillText('🐒', cx, cy);
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, CELL * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // hazards
    hazards.forEach(h => {
      ctx.font = `${h.radius * 2 * CELL}px ${EMOJI_FONT}`;
      ctx.fillText(h.type === 'banana' ? '🍌' : '🛢️', (h.x + 0.5) * CELL, (h.row + 0.5) * CELL);
    });

    // monkey
    const pos = currentMonkeyPos();
    ctx.font = `${CELL * 0.7}px ${EMOJI_FONT}`;
    ctx.fillText('🐒', (pos.col + 0.5) * CELL, (pos.row + 0.5) * CELL);
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

  resizeCanvas();
  resetMonkey();
  spawnHazards();
  draw();
  requestAnimationFrame(loop);
})();
