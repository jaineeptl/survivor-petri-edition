// Petri Dish Survivor (SVG player + SVG bacteria)
// Files expected in same folder as index.html:
//   cell.svg
//   bacteria.svg

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart");

const W = canvas.width;
const H = canvas.height;

const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

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
    // If you ever host on a different domain, you can uncomment:
    // img.crossOrigin = "anonymous";
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
    difficulty: 1,

    dish: {
      cx: W / 2,
      cy: H / 2,
      r: Math.min(W, H) * 0.44
    },

    player: {
      x: W / 2,
      y: H / 2,
      r: 18,
      speed: 260,
      invuln: 0
    },

    nutrients: [],
    bacteria: [],
    particles: [],

    nutrientTimer: 0,
    bacteriaTimer: 0
  };

  updateStatus();
}

function updateStatus() {
  statusEl.textContent = `Score: ${state.score}  •  Lives: ${state.lives}`;
}

// ---- visuals: petri dish background ----
function drawPetriBackground() {
  // agar gradient
  const g = ctx.createRadialGradient(W/2, H/2, 40, W/2, H/2, Math.max(W,H)/1.05);
  g.addColorStop(0, "#193753");
  g.addColorStop(0.55, "#0f2438");
  g.addColorStop(1, "#070e16");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // subtle speckle noise (agar texture)
  ctx.save();
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = Math.random() * 1.8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = Math.random() > 0.5 ? "#cfe4ff" : "#8fb7ff";
    ctx.fill();
  }
  ctx.restore();

  // dish rim + inner shadow + glass highlight
  const R = state.dish.r;

  ctx.save();
  // outer rim
  ctx.globalAlpha = 0.20;
  ctx.lineWidth = 12;
  ctx.strokeStyle = "#cbe3ff";
  ctx.beginPath();
  ctx.arc(W/2, H/2, R + 8, 0, Math.PI*2);
  ctx.stroke();

  // inner rim shadow
  ctx.globalAlpha = 0.20;
  ctx.lineWidth = 18;
  ctx.strokeStyle = "#000000";
  ctx.beginPath();
  ctx.arc(W/2, H/2, R - 2, 0, Math.PI*2);
  ctx.stroke();

  // highlight arc
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = 18;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(W/2 - 80, H/2 - 60, R, -1.2, -0.45);
  ctx.stroke();
  ctx.restore();

  // vignette
  const v = ctx.createRadialGradient(W/2, H/2, 80, W/2, H/2, Math.max(W,H)/1.0);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.46)");
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
  if (state.particles.length > 1200) {
    state.particles.splice(0, state.particles.length - 1200);
  }
}

function drawParticles() {
  for (const p of state.particles) {
    const t = clamp(p.life / p.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = t * (p.type === "trail" ? 0.22 : 0.30);

    if (p.type === "hit") ctx.fillStyle = "#ff9c9c";
    else if (p.type === "nutrient") ctx.fillStyle = "#bfffd0";
    else if (p.type === "slime") ctx.fillStyle = "#ff6b6b";
    else ctx.fillStyle = "#cfe4ff";

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
  const p = randomPointInDish(state.dish, 16);
  const seed = rand(0, 9999);

  state.bacteria.push({
    x: p.x,
    y: p.y,
    r: rand(12, 15),
    speed: rand(85, 125) * state.difficulty,
    seed,
    vx: 1,
    vy: 0
  });
}

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
      spawnParticle("trail", p.x + rand(-6,6), p.y + rand(-6,6), -vx * 50 + rand(-20,20), -vy * 50 + rand(-20,20));
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
    const d = Math.sqrt(dx*dx + dy*dy) || 1;

    b.vx = dx / d;
    b.vy = dy / d;

    // subtle wobble so they feel alive
    const wiggle = Math.sin(state.time * 7 + b.seed) * 0.16;
    const wx = b.vx * Math.cos(wiggle) - b.vy * Math.sin(wiggle);
    const wy = b.vx * Math.sin(wiggle) + b.vy * Math.cos(wiggle);

    b.x += wx * b.speed * dt;
    b.y += wy * b.speed * dt;

    if (Math.random() < 0.20) {
      spawnParticle("slime", b.x + rand(-4,4), b.y + rand(-4,4), -wx * 30 + rand(-10,10), -wy * 30 + rand(-10,10));
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
      updateStatus();
      for (let i = 0; i < 12; i++) spawnParticle("nutrient", n.x, n.y, rand(-90,90), rand(-90,90));
      return false;
    }
    return true;
  });

  // bacteria
  for (let i = state.bacteria.length - 1; i >= 0; i--) {
    const b = state.bacteria[i];
    if (dist(p, b) < p.r + b.r * 0.72) {
      if (p.invuln <= 0) {
        state.bacteria.splice(i, 1);
        state.lives -= 1;
        p.invuln = 0.9;
        updateStatus();
        for (let k = 0; k < 20; k++) spawnParticle("hit", p.x, p.y, rand(-140,140), rand(-140,140));
        if (state.lives <= 0) state.running = false;
      }
    }
  }
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
  ctx.drawImage(img, -s/2, -s/2, s, s);

  ctx.restore();
}

function drawNutrient(n) {
  // glossy droplet (canvas drawn)
  const g = ctx.createRadialGradient(n.x - n.r*0.35, n.y - n.r*0.35, n.r*0.2, n.x, n.y, n.r);
  g.addColorStop(0, "#effff4");
  g.addColorStop(0.55, "#7ee787");
  g.addColorStop(1, "#1b7f45");

  ctx.beginPath();
  ctx.arc(n.x, n.y, n.r, 0, Math.PI*2);
  ctx.fillStyle = g;
  ctx.fill();

  // highlight
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(n.x - n.r*0.35, n.y - n.r*0.35, n.r*0.35, 0, Math.PI*2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

function drawGameOver() {
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#000";
  ctx.fillRect(0,0,W,H);
  ctx.restore();

  drawText("Game Over", W/2, H/2 - 20, 36, "#ffffff", "center");
  drawText(`Final score: ${state.score}`, W/2, H/2 + 18, 18, "rgba(255,255,255,0.9)", "center");
  drawText("Hit Restart to play again", W/2, H/2 + 46, 14, "rgba(255,255,255,0.7)", "center");
}

// ---- main update/draw ----
function update(dt) {
  if (!state.running) {
    updateParticles(dt);
    return;
  }

  state.time += dt;
  state.difficulty = 1 + state.time / 45;

  movePlayer(dt);
  moveBacteria(dt);
  handleCollisions();
  updateParticles(dt);

  // spawn rates (ramp)
  state.nutrientTimer -= dt;
  state.bacteriaTimer -= dt;

  const nutrientInterval = Math.max(0.34, 1.05 - state.time / 150);
  const bacteriaInterval = Math.max(0.52, 1.35 - state.time / 110);

  if (state.nutrientTimer <= 0) {
    spawnNutrient();
    state.nutrientTimer = nutrientInterval;
  }
  if (state.bacteriaTimer <= 0) {
    spawnBacteria();
    state.bacteriaTimer = bacteriaInterval;
  }

  if (state.nutrients.length > 28) state.nutrients.shift();
  if (state.bacteria.length > 20) state.bacteria.shift();
}

function draw() {
  drawPetriBackground();

  // draw dish boundary subtle line
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#cbe3ff";
  ctx.beginPath();
  ctx.arc(state.dish.cx, state.dish.cy, state.dish.r - 10, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();

  // nutrients
  for (const n of state.nutrients) drawNutrient(n);

  // bacteria (SVG), rotate to face movement direction
  for (const b of state.bacteria) {
    const ang = Math.atan2(b.vy, b.vx);
    // tiny wobble rotation
    const wob = Math.sin(state.time * 7 + b.seed) * 0.22;
    drawSprite(bacteriaImg, b.x, b.y, b.r * 3.0, ang + wob, 0.98);
  }

  // player (SVG)
  const p = state.player;
  const pulse = 1 + Math.sin(state.time * 5) * 0.015;

  // glow behind player
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 2.2, 0, Math.PI*2);
  ctx.fillStyle = "#6fb6ff";
  ctx.fill();
  ctx.restore();

  // blink when invulnerable
  const alpha = p.invuln > 0 ? (0.55 + 0.45 * Math.sin(state.time * 30)) : 1;
  drawSprite(cellImg, p.x, p.y, p.r * 3.3 * pulse, 0, alpha);

  // particles on top
  drawParticles();

  // small overlay stats
  drawText(`Difficulty: ${state.difficulty.toFixed(2)}`, 14, 22, 13, "rgba(232,238,247,0.7)", "left");

  if (!state.running) drawGameOver();
}

// ---- boot ----
restartBtn.addEventListener("click", resetGame);

(async function start() {
  try {
    statusEl.textContent = "Loading SVG assets…";

    // IMPORTANT: these names must match your repo files exactly
    [cellImg, bacteriaImg] = await Promise.all([
      loadImage("cell.svg"),
      loadImage("bacteria.svg"),
    ]);

    resetGame();
    statusEl.textContent = `Score: 0  •  Lives: 3`;

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
    statusEl.textContent = "Could not load SVGs. (Try running a local server)";
    // draw a visible message on canvas too
    ctx.clearRect(0,0,W,H);
    drawText("SVGs failed to load.", W/2, H/2 - 10, 22, "#ffffff", "center");
    drawText("Make sure cell.svg and bacteria.svg are in the same folder.", W/2, H/2 + 18, 14, "rgba(255,255,255,0.75)", "center");
    drawText("Then run: python3 -m http.server", W/2, H/2 + 42, 14, "rgba(255,255,255,0.75)", "center");
  }
})();
