
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart");

const W = canvas.width;
const H = canvas.height;

// ---- input ----
const keys = new Set();
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);

  // SPACE triggers pulse on command
  if (e.code === "Space") {
    e.preventDefault();
    tryPulse();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// ---- helpers ----
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (min, max) => Math.random() * (max - min) + min;

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function drawText(str, x, y, size = 14, color = "rgba(232,238,247,0.85)", align = "left") {
  ctx.fillStyle = color;
  ctx.font = `${size}px system-ui`;
  ctx.textAlign = align;
  ctx.fillText(str, x, y);
}

function inDish(dish, x, y, margin = 0) {
  const dx = x - dish.cx;
  const dy = y - dish.cy;
  return (dx * dx + dy * dy) <= (dish.r - margin) * (dish.r - margin);
}

function randomPointInDish(dish, margin = 0) {
  for (let tries = 0; tries < 80; tries++) {
    const x = rand(dish.cx - dish.r + margin, dish.cx + dish.r - margin);
    const y = rand(dish.cy - dish.r + margin, dish.cy + dish.r - margin);
    if (inDish(dish, x, y, margin)) return { x, y };
  }
  return { x: dish.cx, y: dish.cy };
}

function constrainToDish(dish, obj) {
  const dx = obj.x - dish.cx;
  const dy = obj.y - dish.cy;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const maxD = dish.r - obj.r - 2;
  if (d > maxD) {
    obj.x = dish.cx + (dx / d) * maxD;
    obj.y = dish.cy + (dy / d) * maxD;
  }
}

// ---- asset loading (SVG -> Image) ----
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

let cellImg = null;
let bacteriaImg = null;

// ---- game state ----
let state;

function resetGame() {
  state = {
    running: true,
    time: 0,
    score: 0,

    lives: 3,
    maxLives: 3,

    // nutrient bank for pulse spending
    nutrientBank: 0,
    totalNutrientsCollected: 0,

    difficulty: 1,

    dish: {
      cx: W / 2,
      cy: H / 2,
      r: Math.min(W, H) * 0.44
    },

    // smaller cell
    player: {
      x: W / 2,
      y: H / 2,
      r: 14,
      speed: 255,
      invuln: 0
    },

    nutrients: [],
    bacteria: [],
    particles: [],

    nutrientTimer: 0,
    bacteriaTimer: 0,

    // pulse system (manual trigger)
    pulseCost: 5,
    pulseRadius: 130,
    pulseFx: 0,       // ring animation timer
    pulseCooldown: 0  // prevents spam
  };

  updateStatus();
}

function updateStatus() {
  statusEl.textContent =
    `Score: ${state.score} • Lives: ${state.lives} • Nutrients: ${state.nutrientBank} • Pulse: SPACE (-${state.pulseCost})`;
}

// ---- background: blue outside, pink agar inside ----
function drawPetriBackground() {
  // BLUE outer background
  const bg = ctx.createRadialGradient(W * 0.35, H * 0.20, 80, W / 2, H / 2, Math.max(W, H) * 1.2);
  bg.addColorStop(0, "#1d4e97");
  bg.addColorStop(0.55, "#0e2b57");
  bg.addColorStop(1, "#071429");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // clip to dish interior
  const dish = state.dish;
  ctx.save();
  ctx.beginPath();
  ctx.arc(dish.cx, dish.cy, dish.r - 10, 0, Math.PI * 2);
  ctx.clip();

  // PINK agar gradient
  const agar = ctx.createRadialGradient(dish.cx - 70, dish.cy - 70, 30, dish.cx, dish.cy, dish.r);
  agar.addColorStop(0, "#ffd2e4");
  agar.addColorStop(0.55, "#ff9fc6");
  agar.addColorStop(1, "#c85a88");
  ctx.fillStyle = agar;
  ctx.fillRect(0, 0, W, H);

  // subtle agar speckles
  ctx.globalAlpha = 0.10;
  for (let i = 0; i < 260; i++) {
    const x = dish.cx + rand(-dish.r, dish.r);
    const y = dish.cy + rand(-dish.r, dish.r);
    if (!inDish(dish, x, y, 12)) continue;
    const r = Math.random() * 1.8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = Math.random() > 0.5 ? "#fff3f8" : "#ffd2e4";
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // glass rim + inner shadow + highlight arc
  const R = dish.r;

  ctx.save();
  // outer rim
  ctx.globalAlpha = 0.20;
  ctx.lineWidth = 12;
  ctx.strokeStyle = "#cbe3ff";
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, R + 8, 0, Math.PI * 2);
  ctx.stroke();

  // inner shadow
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 18;
  ctx.strokeStyle = "#000000";
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, R - 2, 0, Math.PI * 2);
  ctx.stroke();

  // highlight arc
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = 18;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(W / 2 - 90, H / 2 - 70, R, -1.2, -0.45);
  ctx.stroke();
  ctx.restore();

  // vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, Math.max(W, H) / 1.0);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// ---- particles ----
function spawnParticle(type, x, y, vx, vy) {
  const p = {
    type,
    x, y,
    vx: vx ?? rand(-40, 40),
    vy: vy ?? rand(-40, 40),
    r: type === "trail" ? rand(2, 4) : rand(2, 6),
    life: type === "trail" ? rand(0.18, 0.32) : rand(0.25, 0.7),
    maxLife: 0
  };
  p.maxLife = p.life;
  state.particles.push(p);
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.90;
    p.vy *= 0.90;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
  if (state.particles.length > 1400) {
    state.particles.splice(0, state.particles.length - 1400);
  }
}

function drawParticles() {
  for (const p of state.particles) {
    const t = clamp(p.life / p.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = t * (p.type === "trail" ? 0.18 : 0.28);

    if (p.type === "hit") ctx.fillStyle = "#ff3b7a";
    else if (p.type === "nutrient") ctx.fillStyle = "#d4ffd9";
    else if (p.type === "slime") ctx.fillStyle = "#ff4d6d";
    else if (p.type === "pulse") ctx.fillStyle = "#cbe3ff";
    else ctx.fillStyle = "#ffffff";

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (0.7 + (1 - t) * 0.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ---- entities ----
function spawnNutrient() {
  const p = randomPointInDish(state.dish, 14);
  state.nutrients.push({
    x: p.x,
    y: p.y,
    r: rand(7, 10),
    tw: rand(0, 1000)
  });
}

function spawnBacteria() {
  const p = randomPointInDish(state.dish, 18);
  const seed = rand(0, 9999);

  // Slower difficulty scaling on speed
  const base = rand(62, 88);
  const scaled = base * (1 + (state.difficulty - 1) * 0.45);

  state.bacteria.push({
    x: p.x,
    y: p.y,
    r: rand(12, 15),
    speed: scaled,
    seed,
    vx: 1,
    vy: 0
  });
}

// ---- PULSE (manual trigger) ----
function tryPulse() {
  if (!state || !state.running) return;
  if (state.pulseCooldown > 0) return;

  if (state.nutrientBank < state.pulseCost) {
    return;
  }

  state.nutrientBank -= state.pulseCost;
  state.pulseFx = 0.45;
  state.pulseCooldown = 0.30;

  const p = state.player;
  const R = state.pulseRadius;

  // eliminate bacteria in radius
  for (let i = state.bacteria.length - 1; i >= 0; i--) {
    const b = state.bacteria[i];
    if (dist(p, b) <= R) {
      state.bacteria.splice(i, 1);
      state.score += 18;

      for (let k = 0; k < 18; k++) {
        spawnParticle("hit", b.x, b.y, rand(-160, 160), rand(-160, 160));
      }
    }
  }

  // pulse burst particles from player
  for (let k = 0; k < 36; k++) {
    const ang = rand(0, Math.PI * 2);
    const spd = rand(120, 240);
    spawnParticle("pulse", p.x, p.y, Math.cos(ang) * spd, Math.sin(ang) * spd);
  }

  updateStatus();
}

function drawPulseRing() {
  if (state.pulseFx <= 0) return;

  const p = state.player;
  const t = 1 - (state.pulseFx / 0.45);
  const ringR = state.pulseRadius * (0.92 + 0.10 * t);

  ctx.save();
  ctx.globalAlpha = 0.22 * (1 - t);
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#cbe3ff";
  ctx.beginPath();
  ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.10 * (1 - t);
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ---- HUD meters (Life + Pulse-ready) ----
function drawMeter(x, y, w, h, frac, label, opts = {}) {
  const {
    fill = "rgba(203,227,255,0.9)",
    bg = "rgba(0,0,0,0.35)",
    border = "rgba(255,255,255,0.18)",
    text = "rgba(255,255,255,0.85)",
    flash = false
  } = opts;

  const f = clamp(frac, 0, 1);

  ctx.save();

  // background
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();

  // fill
  const pad = 4;
  const innerW = (w - pad * 2) * f;

  // flashing overlay effect
  let alpha = 1;
  if (flash) alpha = 0.55 + 0.45 * Math.sin(state.time * 12);

  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, innerW, h - pad * 2, 8);
  ctx.fill();
  ctx.globalAlpha = 1;

  // border
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.stroke();

  // label
  ctx.fillStyle = text;
  ctx.font = "12px system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 10, y + h / 2);

  ctx.restore();
}

function drawHUD() {
  const x = 14;
  const y = 14;
  const w = 250;
  const h = 22;
  const gap = 10;

  // LIFE meter
  const lifeFrac = state.lives / state.maxLives;
  drawMeter(
    x, y, w, h,
    lifeFrac,
    `Life ${state.lives}/${state.maxLives}`,
    { fill: "rgba(120, 220, 255, 0.85)" }
  );

  // PULSE meter (flashes when ready)
  const pulseFrac = state.nutrientBank / state.pulseCost;
  const ready = state.nutrientBank >= state.pulseCost;

  drawMeter(
    x, y + h + gap, w, h,
    pulseFrac,
    ready ? `Pulse READY (SPACE)` : `Pulse ${state.nutrientBank}/${state.pulseCost}`,
    {
      fill: ready ? "rgba(180, 255, 220, 0.92)" : "rgba(255, 255, 255, 0.45)",
      flash: ready
    }
  );
}

// ---- drawing SVG sprites ----
function drawSprite(img, x, y, size, rotationRad = 0, alpha = 1) {
  if (!img) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotationRad);
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;

  const s = size;
  ctx.drawImage(img, -s / 2, -s / 2, s, s);
  ctx.restore();
}

function drawNutrient(n) {
  const g = ctx.createRadialGradient(n.x - n.r * 0.35, n.y - n.r * 0.35, n.r * 0.2, n.x, n.y, n.r);
  g.addColorStop(0, "#effff4");
  g.addColorStop(0.55, "#7ee787");
  g.addColorStop(1, "#1b7f45");

  ctx.beginPath();
  ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(n.x - n.r * 0.35, n.y - n.r * 0.35, n.r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

function drawGameOver() {
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  drawText("Game Over", W / 2, H / 2 - 20, 36, "#ffffff", "center");
  drawText(`Final score: ${state.score}`, W / 2, H / 2 + 18, 18, "rgba(255,255,255,0.9)", "center");
  drawText("Hit Restart to play again", W / 2, H / 2 + 46, 14, "rgba(255,255,255,0.7)", "center");
}

// ---- movement + collisions ----
function movePlayer(dt) {
  const p = state.player;
  let vx = 0, vy = 0;

  if (keys.has("arrowleft") || keys.has("a")) vx -= 1;
  if (keys.has("arrowright") || keys.has("d")) vx += 1;
  if (keys.has("arrowup") || keys.has("w")) vy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) vy += 1;

  if (vx !== 0 && vy !== 0) {
    const inv = 1 / Math.sqrt(2);
    vx *= inv; vy *= inv;
  }

  if (vx !== 0 || vy !== 0) {
    for (let k = 0; k < 2; k++) {
      spawnParticle("trail", p.x + rand(-6, 6), p.y + rand(-6, 6), -vx * 50 + rand(-20, 20), -vy * 50 + rand(-20, 20));
    }
  }

  p.x += vx * p.speed * dt;
  p.y += vy * p.speed * dt;
  constrainToDish(state.dish, p);

  p.invuln = Math.max(0, p.invuln - dt);
}

function moveBacteria(dt) {
  const pl = state.player;

  for (const b of state.bacteria) {
    const dx = pl.x - b.x;
    const dy = pl.y - b.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;

    b.vx = dx / d;
    b.vy = dy / d;

    const wiggle = Math.sin(state.time * 6 + b.seed) * 0.14;
    const wx = b.vx * Math.cos(wiggle) - b.vy * Math.sin(wiggle);
    const wy = b.vx * Math.sin(wiggle) + b.vy * Math.cos(wiggle);

    b.x += wx * b.speed * dt;
    b.y += wy * b.speed * dt;

    if (Math.random() < 0.14) {
      spawnParticle("slime", b.x + rand(-4, 4), b.y + rand(-4, 4), -wx * 28 + rand(-10, 10), -wy * 28 + rand(-10, 10));
    }

    constrainToDish(state.dish, b);
  }
}

function handleCollisions() {
  const p = state.player;

  // nutrients
  state.nutrients = state.nutrients.filter(n => {
    if (dist(p, n) < p.r + n.r) {
      state.score += 10;
      state.nutrientBank += 1;
      state.totalNutrientsCollected += 1;

      updateStatus();

      for (let i = 0; i < 12; i++) {
        spawnParticle("nutrient", n.x, n.y, rand(-90, 90), rand(-90, 90));
      }

      // pulse is NOT automatic
      return false;
    }
    return true;
  });

  // bacteria vs player
  for (let i = state.bacteria.length - 1; i >= 0; i--) {
    const b = state.bacteria[i];
    if (dist(p, b) < p.r + b.r * 0.72) {
      if (p.invuln <= 0) {
        state.bacteria.splice(i, 1);
        state.lives -= 1;
        p.invuln = 0.9;
        updateStatus();

        for (let k = 0; k < 20; k++) {
          spawnParticle("hit", p.x, p.y, rand(-140, 140), rand(-140, 140));
        }

        if (state.lives <= 0) state.running = false;
      }
    }
  }
}

// ---- difficulty tuning (slower) ----
function update(dt) {
  // timers
  state.pulseFx = Math.max(0, state.pulseFx - dt);
  state.pulseCooldown = Math.max(0, state.pulseCooldown - dt);

  if (!state.running) {
    updateParticles(dt);
    return;
  }

  state.time += dt;

  // Slower difficulty ramp
  state.difficulty = 1 + state.time / 120;

  movePlayer(dt);
  moveBacteria(dt);
  handleCollisions();
  updateParticles(dt);

  // Slower spawn ramp
  state.nutrientTimer -= dt;
  state.bacteriaTimer -= dt;

  const nutrientInterval = Math.max(0.46, 1.18 - state.time / 280);
  const bacteriaInterval = Math.max(0.95, 1.95 - state.time / 260);

  if (state.nutrientTimer <= 0) {
    spawnNutrient();
    state.nutrientTimer = nutrientInterval;
  }
  if (state.bacteriaTimer <= 0) {
    spawnBacteria();
    state.bacteriaTimer = bacteriaInterval;
  }

  if (state.nutrients.length > 30) state.nutrients.shift();
  if (state.bacteria.length > 18) state.bacteria.shift();
}

// ---- draw ----
function draw() {
  drawPetriBackground();

  // nutrients
  for (const n of state.nutrients) drawNutrient(n);

  // bacteria (SVG)
  for (const b of state.bacteria) {
    const ang = Math.atan2(b.vy, b.vx);
    const wob = Math.sin(state.time * 6.5 + b.seed) * 0.20;
    drawSprite(bacteriaImg, b.x, b.y, b.r * 2.8, ang + wob, 0.98);
  }

  // pulse ring overlay (manual)
  drawPulseRing();

  // player (SVG)
  const p = state.player;
  const pulse = 1 + Math.sin(state.time * 5) * 0.012;

  // glow behind player
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 2.0, 0, Math.PI * 2);
  ctx.fillStyle = "#cbe3ff";
  ctx.fill();
  ctx.restore();

  // blink when invulnerable
  const alpha = p.invuln > 0 ? (0.55 + 0.45 * Math.sin(state.time * 30)) : 1;
  drawSprite(cellImg, p.x, p.y, p.r * 2.6 * pulse, 0, alpha);

  // particles
  drawParticles();

  // HUD meters (life + pulse ready)
  drawHUD();

  if (!state.running) drawGameOver();
}

// ---- boot ----
restartBtn.addEventListener("click", resetGame);

(async function start() {
  try {
    statusEl.textContent = "Loading SVG assets…";
    [cellImg, bacteriaImg] = await Promise.all([
      loadImage("cell.svg"),
      loadImage("bacteria.svg"),
    ]);

    resetGame();

    let last = performance.now();
    function loop(now) {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      update(dt);
      draw();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

  } catch (err) {
    console.error(err);
    statusEl.textContent = "Could not load SVGs. Try running a local server.";
    ctx.clearRect(0, 0, W, H);
    drawText("SVGs failed to load.", W / 2, H / 2 - 10, 22, "#ffffff", "center");
    drawText("Make sure cell.svg and bacteria.svg are in the same folder.", W / 2, H / 2 + 18, 14, "rgba(255,255,255,0.75)", "center");
    drawText("Then run: python3 -m http.server", W / 2, H / 2 + 42, 14, "rgba(255,255,255,0.75)", "center");
  }
})();
