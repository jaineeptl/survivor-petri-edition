// Petri Dish Survivor 

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart");

const W = canvas.width;
const H = canvas.height;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (min, max) => Math.random() * (max - min) + min;

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function circle(x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function text(str, x, y, color = "#e8eef7", size = 16, align = "left") {
  ctx.fillStyle = color;
  ctx.font = `${size}px system-ui`;
  ctx.textAlign = align;
  ctx.fillText(str, x, y);
}

let state;

function resetGame() {
  state = {
    running: true,
    time: 0,
    score: 0,
    lives: 3,
    difficulty: 1,
    player: { x: W / 2, y: H / 2, r: 14, speed: 220 },
    nutrients: [],
    toxins: [],
    nutrientTimer: 0,
    toxinTimer: 0,
  };
  updateStatus();
}

function updateStatus() {
  statusEl.textContent = `Score: ${state.score}  •  Lives: ${state.lives}`;
}

function spawnNutrient() {
  state.nutrients.push({
    x: rand(30, W - 30),
    y: rand(30, H - 30),
    r: 8,
  });
}

function spawnToxin() {
  // Toxin moves slowly toward the player (simple "homing" behavior)
  state.toxins.push({
    x: rand(30, W - 30),
    y: rand(30, H - 30),
    r: 10,
    speed: rand(60, 110) * state.difficulty,
  });
}

function movePlayer(dt) {
  const p = state.player;
  let vx = 0, vy = 0;

  if (keys.has("arrowleft") || keys.has("a")) vx -= 1;
  if (keys.has("arrowright") || keys.has("d")) vx += 1;
  if (keys.has("arrowup") || keys.has("w")) vy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) vy += 1;

  // normalize diagonal
  if (vx !== 0 && vy !== 0) {
    const inv = 1 / Math.sqrt(2);
    vx *= inv; vy *= inv;
  }

  p.x += vx * p.speed * dt;
  p.y += vy * p.speed * dt;

  // keep within dish
  p.x = clamp(p.x, p.r, W - p.r);
  p.y = clamp(p.y, p.r, H - p.r);
}

function moveToxins(dt) {
  const p = state.player;
  for (const t of state.toxins) {
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    t.x += (dx / d) * t.speed * dt;
    t.y += (dy / d) * t.speed * dt;
  }
}

function handleCollisions() {
  const p = state.player;

  // Nutrients
  state.nutrients = state.nutrients.filter((n) => {
    if (dist(p, n) < p.r + n.r) {
      state.score += 10;
      updateStatus();
      return false;
    }
    return true;
  });

  // Toxins
  for (let i = state.toxins.length - 1; i >= 0; i--) {
    const t = state.toxins[i];
    if (dist(p, t) < p.r + t.r) {
      state.toxins.splice(i, 1);
      state.lives -= 1;
      updateStatus();
      if (state.lives <= 0) {
        state.running = false;
      }
    }
  }
}

function update(dt) {
  if (!state.running) return;

  state.time += dt;

  // difficulty slowly ramps up
  state.difficulty = 1 + state.time / 45;

  movePlayer(dt);
  moveToxins(dt);
  handleCollisions();

  // spawn logic (faster over time)
  state.nutrientTimer -= dt;
  state.toxinTimer -= dt;

  const nutrientInterval = Math.max(0.35, 1.1 - state.time / 120);
  const toxinInterval = Math.max(0.55, 1.4 - state.time / 90);

  if (state.nutrientTimer <= 0) {
    spawnNutrient();
    state.nutrientTimer = nutrientInterval;
  }

  if (state.toxinTimer <= 0) {
    spawnToxin();
    state.toxinTimer = toxinInterval;
  }

  // keep object counts sane
  if (state.nutrients.length > 25) state.nutrients.shift();
  if (state.toxins.length > 18) state.toxins.shift();
}

function draw() {
  // background
  ctx.clearRect(0, 0, W, H);

  // petri dish vibe: subtle rings
  ctx.save();
  ctx.globalAlpha = 0.12;
  for (let r = 70; r < 520; r += 70) {
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#9fb6d8";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  // nutrients
  for (const n of state.nutrients) {
    circle(n.x, n.y, n.r, "#7ee787");
  }

  // toxins
  for (const t of state.toxins) {
    circle(t.x, t.y, t.r, "#ff6b6b");
  }

  // player cell
  const p = state.player;
  circle(p.x, p.y, p.r, "#58a6ff");
  ctx.save();
  ctx.globalAlpha = 0.25;
  circle(p.x - 5, p.y - 5, p.r * 0.5, "#ffffff");
  ctx.restore();

  // overlay text
  text(`Difficulty: ${state.difficulty.toFixed(2)}`, 12, 22, "#c9d1d9", 14);

  if (!state.running) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    text("Game Over", W / 2, H / 2 - 10, "#ffffff", 32, "center");
    text(`Final score: ${state.score}`, W / 2, H / 2 + 22, "#ffffff", 18, "center");
    text("Press Restart", W / 2, H / 2 + 50, "#c9d1d9", 14, "center");
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  update(dt);
  draw();
  requestAnimationFrame(loop);
}

restartBtn.addEventListener("click", resetGame);

resetGame();
requestAnimationFrame(loop);
