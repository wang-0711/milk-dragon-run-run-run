(() => {
'use strict';

/* ============================================================
   奶龙快跑 —— 伪3D 三车道跑酷游戏
   主角奶龙向前跑，身后的坏奶龙步步紧逼；
   路上有障碍（栅栏/横梁/大木箱），也有奶瓶和效果球。
   ============================================================ */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

/* roundRect 兼容 */
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
    return this;
  };
}

const startScreen = document.getElementById('startScreen');
const endScreen = document.getElementById('endScreen');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const finalScore = document.getElementById('finalScore');
const finalDist = document.getElementById('finalDist');
const bestText = document.getElementById('bestText');

/* ---------------- 响应式 ---------------- */
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const cw = () => window.innerWidth;
const ch = () => window.innerHeight;

/* ---------------- 透视投影 ---------------- */
const horizon = () => ch() * 0.30;
const playerY = () => ch() * 0.80;
const laneGap = () => Math.min(cw() * 0.20, 140);

function depth(z) { return Math.pow(z, 1.55); }
function py(z) { return horizon() + (playerY() - horizon()) * depth(z); }
function px(lane, z) { return cw() / 2 + (lane - 1) * laneGap() * Math.pow(z, 0.95); }
function pscale(z) { return 0.32 + 0.68 * z; }

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------------- 奶龙贴图（预制透明 PNG，直接使用） ----------------
   不在运行时 getImageData 抠图：双击 file:// 打开时本地图片会污染
   canvas 导致抠图抛错，角色会退回手绘造型。 */
const sprite = { hero: null, chaser: null, ready: false };

const heroImg = new Image();
const chaserImg = new Image();
let flags = 0;
const tryReady = () => { if (flags === 3) sprite.ready = true; };

heroImg.onload = () => { sprite.hero = heroImg; flags |= 1; tryReady(); };
chaserImg.onload = () => { sprite.chaser = chaserImg; flags |= 2; tryReady(); };
heroImg.src = '玩家.png';
chaserImg.src = '反派.png';

/* ---------------- 工具：存储最高分 ---------------- */
function loadBest() { return parseInt(localStorage.getItem('nailong_best') || '0', 10); }
function saveBest(v) { localStorage.setItem('nailong_best', String(v)); }

/* ---------------- 游戏状态 ---------------- */
const Game = {
  state: 'menu', // menu | playing | over
  score: 0,
  distance: 0,
  coins: 0,
  best: loadBest(),
  speed: 0,
  time: 0,
  spawnTimer: 0,
  spawnInterval: 1.1,
  lastDouble: false,   // 上一排障碍是否堵了两条车道

  gap: 55,          // 与坏奶龙的距离 0~100（0=被追上）
  gapDecay: 3.2,    // 每秒自然缩减

  objects: [],      // 障碍 / 金币 / 奶瓶 / 效果球
  particles: [],
  clouds: [],
  scenery: [],      // 路侧景物（树/灌木/石头）
  sceneryTimer: 0,
  dustT: 0,         // 玩家脚下跑步扬尘计时
  shake: 0,
};

const player = {
  lane: 1,
  visualLane: 1,
  jumping: false, jumpT: 0, jumpDur: 0.8,
  sliding: false, slideT: 0, slideDur: 0.72,
  stunned: false, stunT: 0, stunDur: 0.55,
  shield: false,
  star: false, starT: 0, starDur: 4.5,
  magnet: false, magnetT: 0, magnetDur: 5,
  invuln: 0,
};

const effects = [
  { key: 'shield', name: '护盾', color: '#4cc9f0', char: '🛡' },
  { key: 'star',   name: '无敌', color: '#ffd166', char: '★' },
  { key: 'magnet', name: '磁铁', color: '#f72585', char: '🧲' },
  { key: 'boost',  name: '加速', color: '#80ed99', char: '⚡' },
];

/* ---------------- 初始化云朵 ---------------- */
function initClouds() {
  Game.clouds = [];
  for (let i = 0; i < 6; i++) {
    Game.clouds.push({
      x: rand(0, 1),
      y: rand(0.04, 0.20),
      s: rand(0.5, 1.3),
      sp: rand(0.005, 0.016),
    });
  }
}
initClouds();

/* ---------------- 开始 / 重置 ---------------- */
function reset() {
  player.lane = 1;
  player.visualLane = 1;
  player.jumping = false; player.sliding = false;
  player.stunned = false; player.shield = false;
  player.star = false; player.magnet = false; player.invuln = 0;
  Game.score = 0;
  Game.distance = 0;
  Game.coins = 0;
  Game.speed = 0.34;
  Game.time = 0;
  Game.spawnTimer = 0.9;
  Game.spawnInterval = 1.1;
  Game.lastDouble = false;
  Game.gap = 55;
  Game.gapDecay = 3.2;
  Game.objects = [];
  Game.particles = [];
  Game.shake = 0;
  // 预先在路两侧撒一些景物，开局就不空旷
  Game.scenery = [];
  for (let i = 0; i < 10; i++) {
    Game.scenery.push({ side: i % 2 ? 1 : -1, z: rand(0.05, 1.08), kind: Math.random() * 3 | 0 });
  }
  Game.sceneryTimer = 0.35;
  Game.dustT = 0;
}

function startGame() {
  reset();
  Game.state = 'playing';
  startScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
}

function endGame() {
  Game.state = 'over';
  Game.best = Math.max(Game.best, Math.floor(Game.score));
  saveBest(Game.best);
  finalScore.textContent = String(Math.floor(Game.score));
  finalDist.textContent = String(Math.floor(Game.distance));
  bestText.textContent = '最高分 ' + Game.best;
  setTimeout(() => endScreen.classList.remove('hidden'), 500);
}

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);

/* ---------------- 输入 ---------------- */
function moveLeft() {
  if (Game.state !== 'playing' || player.stunned) return;
  if (player.lane > 0) player.lane--;
}
function moveRight() {
  if (Game.state !== 'playing' || player.stunned) return;
  if (player.lane < 2) player.lane++;
}
function jump() {
  if (Game.state !== 'playing' || player.stunned) return;
  if (!player.jumping && !player.sliding) {
    player.jumping = true;
    player.jumpT = 0;
  }
}
function slide() {
  if (Game.state !== 'playing' || player.stunned) return;
  if (!player.sliding) {
    player.sliding = true;
    player.slideT = 0;
    player.jumping = false;
  }
}

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') moveLeft();
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') moveRight();
  else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') jump();
  else if (k === 'ArrowDown' || k === 's' || k === 'S') slide();
});

/* 触摸/滑动 */
let touchStart = null;
function onTouchStart(e) {
  const t = e.touches[0];
  touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
}
function onTouchEnd(e) {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (Math.max(adx, ady) < 24) { jump(); } // 轻点 = 跳
  else if (adx > ady) { dx > 0 ? moveRight() : moveLeft(); }
  else { dy > 0 ? slide() : jump(); }
  touchStart = null;
}
canvas.addEventListener('touchstart', onTouchStart, { passive: true });
canvas.addEventListener('touchend', onTouchEnd, { passive: true });

/* ---------------- 生成物体（按"排"生成，保证可闪避） ---------------- */
function shuffleLanes() {
  const a = [0, 1, 2];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.random() * (i + 1) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function spawnRow() {
  const roll = Math.random();
  if (roll < 0.46) {
    // 障碍排：最多堵 2 条车道，永远留至少 1 条空道；
    // 上一排已堵 2 条，这一排只堵 1 条，保证有反应时间切回去。
    const two = !Game.lastDouble && Math.random() < 0.38;
    const blocked = shuffleLanes().slice(0, two ? 2 : 1);
    const kinds = ['low', 'high', 'full'];
    for (const lane of blocked) {
      const kind = kinds[Math.random() * kinds.length | 0];
      Game.objects.push({ type: 'obstacle', kind, lane, z: 0, hit: false });
    }
    Game.lastDouble = two;
  } else if (roll < 0.74) {
    // 金币串：某条车道 3~5 枚（远处那几枚在视野外，随靠近逐枚出现）
    const lane = Math.random() * 3 | 0;
    const n = 3 + (Math.random() * 3 | 0);
    for (let k = 0; k < n; k++) {
      Game.objects.push({ type: 'coin', lane, z: -k * 0.085, got: false, spin: Math.random() * 6 });
    }
    Game.lastDouble = false;
  } else if (roll < 0.90) {
    // 奶瓶串
    const lane = Math.random() * 3 | 0;
    for (let k = 0; k < 3; k++) {
      Game.objects.push({ type: 'bottle', lane, z: -k * 0.09, got: false, flavor: Math.random() });
    }
    Game.lastDouble = false;
  } else {
    // 效果球
    const eff = effects[Math.random() * effects.length | 0];
    Game.objects.push({ type: 'power', kind: eff.key, lane: Math.random() * 3 | 0, z: 0, got: false });
    Game.lastDouble = false;
  }
}

/* ---------------- 效果球 / 奶瓶收集 ---------------- */
function applyPower(kind) {
  player.invuln = Math.max(player.invuln, 0.15);
  if (kind === 'shield') player.shield = true;
  else if (kind === 'star') { player.star = true; player.starT = 0; }
  else if (kind === 'magnet') { player.magnet = true; player.magnetT = 0; }
  else if (kind === 'boost') {
    Game.gap = clamp(Game.gap + 38, 0, 100);
    Game.speed *= 1.001;
    spawnBurst(player.lane, '#80ed99', 18);
  }
}

function collectBottle() {
  Game.score += 5;
  Game.gap = clamp(Game.gap + 2, 0, 100);
  spawnBurst(player.lane, '#ffe08a', 8);
}

function collectCoin() {
  Game.coins += 1;
  Game.score += 10;
  spawnBurst(player.lane, '#ffd23f', 6);
}

/* ---------------- 撞击 ---------------- */
function crash(obj) {
  if (player.invuln > 0 || player.star) return;      // 无敌帧 / 无敌星
  if (player.shield) {                                // 护盾抵消一次
    player.shield = false;
    player.invuln = 0.9;
    obj.dead = true;
    spawnBurst(player.lane, '#4cc9f0', 16);
    Game.shake = 4;
    return;
  }
  // 踉跄
  player.stunned = true;
  player.stunT = 0;
  player.jumping = false;
  player.sliding = false;
  player.invuln = 0.9;
  Game.gap = clamp(Game.gap - 20, 0, 100);
  Game.shake = 10;
  spawnBurst(player.lane, '#ff6b6b', 18);
  obj.dead = true;
}

/* ---------------- 粒子 ---------------- */
function spawnBurst(lane, color, n) {
  const bx = px(lane, 0.9);
  const by = py(0.9);
  for (let i = 0; i < n; i++) {
    Game.particles.push({
      x: bx, y: by,
      vx: rand(-140, 140), vy: rand(-220, -40),
      life: rand(0.35, 0.7), t: 0,
      color, r: rand(2, 5),
    });
  }
}

/* ---------------- 更新 ---------------- */
function update(dt) {
  if (Game.state !== 'playing') return;
  Game.time += dt;

  // 速度随距离缓慢提升
  const targetSpeed = Math.min(0.34 + Game.distance * 0.00012, 0.62);
  Game.speed = lerp(Game.speed, targetSpeed, 1 - Math.pow(0.001, dt));

  // 距离 & 分数
  Game.distance += Game.speed * dt * 36;   // 换算成"米"
  Game.score += Game.speed * dt * 14;

  // 追逐距离
  Game.gapDecay = 2.2 + Game.distance * 0.0006;
  if (!player.star) Game.gap = clamp(Game.gap - Game.gapDecay * dt, 0, 100);

  // 无敌星 / 磁铁计时
  if (player.star) {
    player.starT += dt;
    Game.gap = clamp(Game.gap + 6 * dt, 0, 100);
    if (player.starT >= player.starDur) { player.star = false; }
  }
  if (player.magnet) {
    player.magnetT += dt;
    if (player.magnetT >= player.magnetDur) player.magnet = false;
  }
  if (player.invuln > 0) player.invuln -= dt;

  // 踉跄计时
  if (player.stunned) {
    player.stunT += dt;
    if (player.stunT >= player.stunDur) player.stunned = false;
  }

  // 跳跃 / 下蹲
  if (player.jumping) {
    player.jumpT += dt;
    if (player.jumpT >= player.jumpDur) player.jumping = false;
  }
  if (player.sliding) {
    player.slideT += dt;
    if (player.slideT >= player.slideDur) player.sliding = false;
  }

  // 车道视觉平滑
  player.visualLane = lerp(player.visualLane, player.lane, 1 - Math.pow(0.0001, dt));

  // 踉跄减速
  const moveSpeed = player.stunned ? 0.06 : 1;

  // 生成（按排，节奏下限保证反应时间）
  Game.spawnInterval = Math.max(0.72, 1.18 - Game.distance * 0.0003);
  Game.spawnTimer -= dt * (player.stunned ? 0 : 1);
  if (Game.spawnTimer <= 0) {
    spawnRow();
    Game.spawnTimer = Game.spawnInterval * rand(0.85, 1.2);
  }

  // 更新物体
  const step = Game.speed * moveSpeed * dt;
  const mag = player.magnet && !player.stunned;
  const laneNow = Math.round(player.visualLane);

  for (let i = Game.objects.length - 1; i >= 0; i--) {
    const o = Game.objects[i];
    o.z += step;

    // 磁铁吸引金币 / 奶瓶
    if (mag && (o.type === 'coin' || o.type === 'bottle') && o.z > 0.3) {
      if (Math.abs(o.lane - player.lane) <= 1) o.lane = player.lane;
    }

    // 碰撞 / 收集判定（z 窗口收窄，跳跃越过更宽松）
    if (o.z >= 0.85 && o.z <= 1.03) {
      if (o.type === 'obstacle' && !o.hit && o.lane === laneNow) {
        if (checkObstacle(o)) { o.hit = true; }
      } else if (o.type === 'coin' && !o.got && o.lane === laneNow) {
        o.got = true; o.dead = true; collectCoin();
      } else if (o.type === 'bottle' && !o.got && o.lane === laneNow) {
        o.got = true; o.dead = true; collectBottle();
      } else if (o.type === 'power' && !o.got && o.lane === laneNow) {
        o.got = true; o.dead = true; applyPower(o.kind);
      }
    }

    if (o.z > 1.15 || o.dead) Game.objects.splice(i, 1);
  }

  // 路侧景物（随世界向玩家移动）
  Game.sceneryTimer -= dt;
  if (Game.sceneryTimer <= 0) {
    Game.scenery.push({ side: -1, z: 0.02, kind: Math.random() * 3 | 0 });
    Game.scenery.push({ side: 1, z: rand(0, 0.25), kind: Math.random() * 3 | 0 });
    Game.sceneryTimer = rand(0.55, 0.95);
  }
  for (let i = Game.scenery.length - 1; i >= 0; i--) {
    const sc = Game.scenery[i];
    sc.z += step;
    if (sc.z > 1.2) Game.scenery.splice(i, 1);
  }

  // 被追上
  if (Game.gap <= 0) {
    endGame();
    return;
  }

  // 粒子
  for (let i = Game.particles.length - 1; i >= 0; i--) {
    const p = Game.particles[i];
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 500 * dt;
    if (p.t >= p.life) Game.particles.splice(i, 1);
  }

  // 玩家脚下跑步扬尘（地面不动，用扬尘表现"玩家在跑"）
  Game.dustT -= dt;
  if (Game.dustT <= 0 && !player.stunned && !player.jumping && !player.sliding) {
    Game.dustT = 0.11;
    Game.particles.push({
      x: px(player.visualLane, 1) + rand(-16, 16),
      y: playerY() + 2,
      vx: rand(-70, 70), vy: rand(-70, -20),
      life: 0.42, t: 0,
      color: 'rgba(170,160,140,0.55)', r: rand(3, 6),
    });
  }

  // 云
  for (const c of Game.clouds) {
    c.x += c.sp * dt;
    if (c.x > 1.15) c.x = -0.15;
  }

  if (Game.shake > 0) Game.shake -= dt * 18;
}

function checkObstacle(o) {
  // full 木箱：只能换道；low 栅栏：跳过即可；high 横梁：下蹲钻过
  if (o.kind === 'full') { crash(o); return true; }
  if (o.kind === 'low') {
    // 起跳后弧线的大部分区间都算成功越过（判定宽松，避免"跳了还撞"）
    const t = player.jumpT / player.jumpDur;
    const airborne = player.jumping && t > 0.06 && t < 0.96;
    if (!airborne) { crash(o); return true; }
  }
  if (o.kind === 'high') {
    if (!player.sliding) { crash(o); return true; }
  }
  return false;
}

/* ============================================================
   渲染
   ============================================================ */
function draw() {
  ctx.clearRect(0, 0, cw(), ch());

  ctx.save();
  if (Game.shake > 0) {
    ctx.translate(rand(-Game.shake, Game.shake), rand(-Game.shake, Game.shake));
  }

  drawSky();
  drawRoad();
  drawScenery();
  drawObjects();
  drawPlayer();
  drawChaser();
  if (Game.state === 'playing') drawHUD();

  ctx.restore();

  // 粒子（最上层，不受 shake 影响示意够用）
  drawParticles();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, ch());
  g.addColorStop(0, '#5db9ff');
  g.addColorStop(0.55, '#a5d8ff');
  g.addColorStop(1, '#d0ecff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw(), ch());

  // 太阳
  const sx = cw() * 0.82, sy = ch() * 0.12;
  const r = ch() * 0.05;
  ctx.save();
  ctx.fillStyle = '#fff7d6';
  ctx.beginPath(); ctx.arc(sx, sy, r * 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // 云
  for (const c of Game.clouds) {
    drawCloud(cw() * c.x, ch() * c.y, c.s);
  }

  // 远景山丘
  ctx.fillStyle = '#a8d8a0';
  ctx.beginPath();
  ctx.moveTo(0, horizon());
  for (let x = 0; x <= cw(); x += 40) {
    ctx.lineTo(x, horizon() - Math.sin(x * 0.008 + 1) * ch() * 0.06 - ch() * 0.02);
  }
  ctx.lineTo(cw(), horizon());
  ctx.closePath(); ctx.fill();
}

function drawCloud(x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.arc(22, -8, 18, 0, Math.PI * 2);
  ctx.arc(-22, -4, 16, 0, Math.PI * 2);
  ctx.arc(8, 8, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRoad() {
  const h = horizon();
  const bottom = ch();
  const cx = cw() / 2;
  const lg = laneGap();
  const nearHalf = lg * 1.6;   // 底部跑道半宽

  // 路侧草地（上下渐变，近处更绿更深）
  const gg = ctx.createLinearGradient(0, h, 0, bottom);
  gg.addColorStop(0, '#8fd47f');
  gg.addColorStop(1, '#57a94e');
  ctx.fillStyle = gg;
  ctx.fillRect(0, h, cw(), bottom - h);

  // 跑道主体（梯形沥青，远亮近暗）
  const ag = ctx.createLinearGradient(0, h, 0, bottom);
  ag.addColorStop(0, '#7c8593');
  ag.addColorStop(1, '#3e464f');
  ctx.fillStyle = ag;
  ctx.beginPath();
  ctx.moveTo(cx - 4, h);
  ctx.lineTo(cx - nearHalf, bottom);
  ctx.lineTo(cx + nearHalf, bottom);
  ctx.lineTo(cx + 4, h);
  ctx.closePath(); ctx.fill();

  // 地面完全静止：车道虚线固定在路面上，不随跑动移动
  const dashP = 0.2, dashLen = 0.1;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z1 = 0.04 + i * dashP;
      const z2 = z1 + dashLen;
      if (z2 > 1) break;
      roadBand(side * 0.5, 0.04, z1, Math.min(z2, 1), 'rgba(255,255,255,0.85)');
    }
  }

  // 红白路缘石（固定位置，不滚动）
  const curbP = 0.16;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const z1 = 0.02 + i * curbP;
      const z2 = z1 + curbP;
      if (z1 > 1) break;
      roadBand(side * 1.55, 0.11, z1, Math.min(z2, 1),
        (i % 2 === 0) ? '#e23b3b' : '#f5f5f5');
    }
  }
}

// 在车道系数坐标系里画一段透视梯形路面带
function roadBand(fc, hw, z1, z2, style) {
  const cx = cw() / 2, lg = laneGap();
  const x1a = cx + (fc - hw) * lg * Math.pow(z1, 0.95);
  const x1b = cx + (fc + hw) * lg * Math.pow(z1, 0.95);
  const x2a = cx + (fc - hw) * lg * Math.pow(z2, 0.95);
  const x2b = cx + (fc + hw) * lg * Math.pow(z2, 0.95);
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.moveTo(x1a, py(z1)); ctx.lineTo(x1b, py(z1));
  ctx.lineTo(x2b, py(z2)); ctx.lineTo(x2a, py(z2));
  ctx.closePath(); ctx.fill();
}

/* 路侧景物：树 / 灌木 / 石头，随世界向镜头移动 */
function drawScenery() {
  const sorted = Game.scenery.slice().sort((a, b) => a.z - b.z);
  for (const sc of sorted) {
    if (sc.z <= 0.03 || sc.z > 1.12) continue;
    const z = sc.z, s = pscale(z);
    const edgeX = cw() / 2 + sc.side * laneGap() * 1.6 * Math.pow(z, 0.95);
    const x = edgeX + sc.side * (24 * s + 14);
    const y = py(z);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    // 落地阴影
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(0, 0, 34, 8, 0, 0, Math.PI * 2); ctx.fill();
    if (sc.kind === 0) {
      // 树
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(-5, -46, 10, 46);
      ctx.fillStyle = '#3f9a44';
      ctx.beginPath(); ctx.arc(0, -62, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#55b353';
      ctx.beginPath(); ctx.arc(-14, -52, 17, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(15, -55, 16, 0, Math.PI * 2); ctx.fill();
    } else if (sc.kind === 1) {
      // 灌木
      ctx.fillStyle = '#4aa24c';
      ctx.beginPath(); ctx.arc(-12, -12, 14, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(4, -16, 17, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(18, -10, 12, 0, Math.PI * 2); ctx.fill();
    } else {
      // 石头
      ctx.fillStyle = '#9aa3ad';
      ctx.beginPath(); ctx.ellipse(0, -10, 20, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b6bec7';
      ctx.beginPath(); ctx.ellipse(-5, -14, 9, 6, -0.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

/* 奶龙绘制（主角 / 追捕者）—— 圆滚滚可爱造型 + 明显奔跑动画 */
function drawDragon(x, y, s, opts = {}) {
  const {
    angry = false,
    sliding = false,
    jumping = false,
    stunned = false,
    runPhase = 0,
  } = opts;

  const cycle = runPhase * 11;        // 跑步步频
  const stride = Math.sin(cycle);      // 主摆动 -1..1
  const bounce = Math.abs(stride) * 5; // 每步落地身体弹起

  ctx.save();
  ctx.translate(x, y);
  if (sliding) ctx.scale(1.15, 0.6);  // 下蹲：横向略宽、纵向压扁贴地
  ctx.scale(s, s);
  const bob = jumping ? 0 : -bounce;  // 身体上下起伏（向上为负）

  // ---- 尾巴（身后翘起的小圆尾，左右甩）----
  const tailSw = Math.sin(cycle) * 10;
  ctx.fillStyle = '#ffcf3f';
  ctx.save();
  ctx.translate(-46, -40 + bob);
  ctx.rotate(-0.35 + tailSw * 0.015);
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe9a0';
  ctx.beginPath();
  ctx.ellipse(9, -3, 7, 5, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ---- 腿（两条交替迈步，跑步的关键）----
  const lift = 16;
  const yL = jumping ? 12 : Math.max(0, stride) * lift;
  const yR = jumping ? 12 : Math.max(0, -stride) * lift;
  drawLeg(-21, -20 + bob, yL);
  drawLeg(8, -20 + bob, yR);

  // ---- 翅膀（两侧扑腾）----
  const wing = Math.sin(cycle * 1.25) * 0.35;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 48, -56 + bob);
    ctx.rotate(side * (0.45 + wing));
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(side * 32, -18, side * 38, 6);
    ctx.quadraticCurveTo(side * 20, 16, 0, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---- 身体（圆滚滚，头身一体）----
  ctx.fillStyle = '#ffd93b';
  ctx.beginPath();
  ctx.ellipse(0, -54 + bob, 46, 50, 0, 0, Math.PI * 2);
  ctx.fill();

  // 肚皮（奶白）
  ctx.fillStyle = '#fffbe8';
  ctx.beginPath();
  ctx.ellipse(0, -28 + bob, 30, 30, 0, 0, Math.PI * 2);
  ctx.fill();

  // ---- 眼睛（超大眼睛，奶龙的萌点）----
  const eyeY = -70 + bob;
  for (const side of [-1, 1]) {
    const ex = side * 19;
    // 眼白
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 14, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    // 黑瞳
    ctx.fillStyle = '#2c2418';
    ctx.beginPath();
    ctx.ellipse(ex + (angry ? 1 : 2), eyeY + 1, angry ? 8 : 9.5, angry ? 9 : 11, 0, 0, Math.PI * 2);
    ctx.fill();
    // 高光（两点，水汪汪）
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex + 4, eyeY - 4, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex - 3, eyeY + 4, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  // ---- 怒眉 ----
  if (angry) {
    ctx.strokeStyle = '#9a5a00';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-19 - 14, eyeY - 16);
    ctx.lineTo(-19 + 3, eyeY - 9);
    ctx.moveTo(19 + 14, eyeY - 16);
    ctx.lineTo(19 - 3, eyeY - 9);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // ---- 嘴 ----
  ctx.lineWidth = 2.5;
  if (stunned) {
    ctx.strokeStyle = '#9a5a00';
    ctx.beginPath(); ctx.arc(0, eyeY + 22, 7, 0, Math.PI * 2); ctx.stroke();
  } else if (angry) {
    ctx.fillStyle = '#8c3a00';
    ctx.beginPath(); ctx.ellipse(0, eyeY + 18, 8, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, eyeY + 15, 2.5, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = '#9a5a00';
    ctx.beginPath(); ctx.arc(0, eyeY + 15, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }

  // ---- 腮红 ----
  ctx.fillStyle = 'rgba(255,130,120,0.5)';
  ctx.beginPath();
  ctx.ellipse(-32, eyeY + 16, 8, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(32, eyeY + 16, 8, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // ---- 呆毛 ----
  ctx.strokeStyle = '#e8a200';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -104 + bob);
  ctx.quadraticCurveTo(2, -116, 10, -113);
  ctx.stroke();
  ctx.lineCap = 'butt';

  ctx.restore();
}

// 画一条小短腿（迈步：lift 为脚抬起的量）
function drawLeg(legX, topY, lift) {
  const footY = -lift;              // 脚底（抬起时向上）
  const len = Math.max(4, footY - topY);
  // 腿
  ctx.fillStyle = '#f7a800';
  ctx.beginPath();
  ctx.roundRect(legX, topY, 20, len, 8);
  ctx.fill();
  // 脚掌
  ctx.fillStyle = '#e8870c';
  ctx.beginPath();
  ctx.roundRect(legX - 2, footY - 6, 24, 8, 4);
  ctx.fill();
}

function drawObstacle(o) {
  const x = px(o.lane, o.z);
  const y = py(o.z);
  const s = pscale(o.z);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  if (o.kind === 'low') {
    // 矮栅栏（可跳过）
    ctx.fillStyle = '#8d5a3b';
    ctx.fillRect(-46, -38, 92, 38);
    ctx.fillStyle = '#6f4529';
    for (let i = -40; i <= 40; i += 20) {
      ctx.fillRect(i, -38, 8, 38);
    }
    ctx.fillStyle = '#b97a4b';
    ctx.fillRect(-46, -44, 92, 8);
    ctx.fillRect(-46, -8, 92, 8);
  } else if (o.kind === 'high') {
    // 横梁（中空，可下蹲钻过）
    ctx.fillStyle = '#8d5a3b';
    ctx.fillRect(-46, -146, 92, 34);
    ctx.fillStyle = '#6f4529';
    ctx.fillRect(-42, -112, 13, 82);
    ctx.fillRect(29, -112, 13, 82);
    ctx.fillStyle = '#b97a4b';
    ctx.fillRect(-48, -150, 96, 8);
  } else {
    // 大木箱（只能换道闪避）
    ctx.fillStyle = '#c98a4b';
    ctx.fillRect(-62, -120, 124, 120);
    ctx.fillStyle = '#b97a3b';
    ctx.fillRect(-62, -120, 124, 18);
    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = 6;
    ctx.strokeRect(-62, -120, 124, 120);
    ctx.beginPath();
    ctx.moveTo(-62, -120); ctx.lineTo(62, 0);
    ctx.moveTo(62, -120); ctx.lineTo(-62, 0);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBottle(o) {
  const x = px(o.lane, o.z);
  const y = py(o.z) - 20 * pscale(o.z);
  const s = pscale(o.z);
  const bob = Math.sin(Game.time * 6 + o.flavor * 6) * 6;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(s, s);

  // 奶瓶
  ctx.fillStyle = '#f4f9ff';
  ctx.beginPath();
  ctx.roundRect(-14, -4, 28, 34, 6);
  ctx.fill();
  ctx.fillStyle = '#ffe08a';
  ctx.beginPath();
  ctx.roundRect(-8, -14, 16, 12, 3);
  ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.roundRect(-7, 4, 14, 20, 4);
  ctx.fill();
  // 奶滴图案
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(0, -2, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPower(o) {
  const meta = effects.find(e => e.key === o.kind);
  if (!meta) return;
  const x = px(o.lane, o.z);
  const y = py(o.z) - 34 * pscale(o.z);
  const s = pscale(o.z);
  const bob = Math.sin(Game.time * 7) * 6;
  const glow = 0.6 + Math.sin(Game.time * 9) * 0.25;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(s, s);

  // 光晕
  ctx.fillStyle = meta.color;
  ctx.globalAlpha = glow * 0.35;
  ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // 球体
  const g = ctx.createRadialGradient(-6, -8, 4, 0, 0, 22);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, meta.color);
  g.addColorStop(1, shade(meta.color, -0.35));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();

  // 图标
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.char, 0, 1);

  ctx.restore();
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/* 金币：悬浮在路面上，水平翻转模拟旋转 */
function drawCoin(o) {
  const x = px(o.lane, o.z);
  const y = py(o.z) - 32 * pscale(o.z);
  const s = pscale(o.z);
  const sq = Math.abs(Math.cos(Game.time * 5 + o.spin));  // 0~1 旋转宽度
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // 光晕
  ctx.fillStyle = 'rgba(255,210,63,0.25)';
  ctx.beginPath(); ctx.arc(0, 0, 21, 0, Math.PI * 2); ctx.fill();
  // 落地淡影
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath(); ctx.ellipse(0, 30, 12, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  // 金币本体
  ctx.save();
  ctx.scale(0.3 + 0.7 * sq, 1);
  const g = ctx.createRadialGradient(-5, -7, 3, 0, 0, 18);
  g.addColorStop(0, '#fff3b0');
  g.addColorStop(0.5, '#ffd23f');
  g.addColorStop(1, '#e0961a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#b97b12';
  ctx.stroke();
  // ¥ 字
  ctx.fillStyle = '#b97b12';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('¥', 0, 1);
  ctx.restore();
  ctx.restore();
}

function drawObjects() {
  // 所有物体按 z 从远到近统一排序，互相遮挡才正确
  const sorted = Game.objects.slice().sort((a, b) => a.z - b.z);
  for (const o of sorted) {
    if (o.z <= 0.03) continue;  // 还在地平线外的串内物体
    if (o.type === 'obstacle') drawObstacle(o);
    else if (o.type === 'coin') drawCoin(o);
    else if (o.type === 'bottle') drawBottle(o);
    else if (o.type === 'power') drawPower(o);
  }
}

// 用抠图贴图绘制奶龙：cx 中心x，bottomY 脚底y
function drawSprite(img, cx, bottomY, w, opts = {}) {
  const { bob = 0, squash = 1, sway = 0, alpha = 1 } = opts;
  if (!img) return;
  const h = w * (img.height / img.width) * squash;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, cx - w / 2 + sway, bottomY - h + bob, w, h);
  ctx.restore();
}

function drawPlayer() {
  if (Game.state === 'menu') return;
  const x = px(player.visualLane, 1);
  const baseY = playerY();

  let yOffset = 0;
  let sliding = player.sliding;
  let jumping = player.jumping;

  if (player.jumping) {
    const t = player.jumpT / player.jumpDur;
    yOffset = -Math.sin(t * Math.PI) * ch() * 0.18;
  }
  if (player.sliding) {
    yOffset += 12;
  }
  const y = baseY + yOffset;

  // 护盾光圈
  if (player.shield) {
    ctx.save();
    ctx.strokeStyle = 'rgba(76,201,240,0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(x, baseY - 46, 62, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#4cc9f0';
    ctx.fill();
    ctx.restore();
  }

  // 无敌闪烁
  if (player.star) {
    ctx.save();
    ctx.fillStyle = `rgba(255,209,102,${0.3 + Math.sin(Game.time * 18) * 0.2})`;
    ctx.beginPath(); ctx.arc(x, baseY - 46, 64, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // 无敌帧闪烁（受伤后短暂）
  const heroAlpha = (player.invuln > 0 && !player.star && !player.shield && Math.floor(Game.time * 14) % 2 === 0) ? 0.5 : 1;

  // 跑步弹跳 + 轻微摇摆，让照片有"跑起来"的感觉
  const runPhase = Game.time * 11;
  const bob = -Math.abs(Math.sin(runPhase)) * 5;
  const sway = Math.sin(runPhase) * 3;

  if (sprite.ready) {
    drawSprite(sprite.hero, x, y, 96, {
      bob, squash: sliding ? 0.62 : 1, sway, alpha: heroAlpha,
    });
  } else {
    ctx.globalAlpha = heroAlpha;
    drawDragon(x, y, 1.05, { sliding, jumping, stunned: player.stunned, runPhase: Game.time });
    ctx.globalAlpha = 1;
  }

  // 踉跄星圈
  if (player.stunned) {
    ctx.save();
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 4;
    const tilt = Math.sin(Game.time * 30) * 3;
    ctx.translate(x, baseY - 96);
    ctx.rotate(tilt);
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

function drawChaser() {
  if (Game.state !== 'playing') return;
  const t = clamp(Game.gap / 100, 0, 1);  // 1=远 0=被追到
  const cx = px(Math.round(player.visualLane), 1);
  const cy = playerY() + lerp(20, ch() * 0.42, t);
  const s = lerp(1.12, 0.78, t);

  if (cy - 60 >= ch()) return;

  const runPhase = Game.time * 11 + 0.5;
  const bob = -Math.abs(Math.sin(runPhase)) * 5;
  if (sprite.ready) {
    drawSprite(sprite.chaser, cx, cy, 96 * s, { bob });
  } else {
    drawDragon(cx, cy, s, { angry: true, runPhase: Game.time + 0.5 });
  }
}

function drawHUD() {
  const pad = 14;
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // ---- 左上角：跑动距离（大号、最醒目）----
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillText('跑动距离', pad + 1, pad + 1);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText('跑动距离', pad, pad);

  ctx.font = 'bold 34px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText(Math.floor(Game.distance) + ' m', pad + 2, pad + 18);
  ctx.fillStyle = '#ffe066';
  ctx.fillText(Math.floor(Game.distance) + ' m', pad, pad + 16);

  // ---- 第二行：金币 + 分数 ----
  let lx = pad;
  const cy2 = pad + 60;
  // 小金币图标
  const cg = ctx.createRadialGradient(lx + 8, cy2 + 7, 1, lx + 9, cy2 + 9, 10);
  cg.addColorStop(0, '#fff3b0');
  cg.addColorStop(0.6, '#ffd23f');
  cg.addColorStop(1, '#d99216');
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(lx + 9, cy2 + 9, 9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b97b12'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#9c6708';
  ctx.textAlign = 'center';
  ctx.fillText('¥', lx + 9, cy2 + 3);
  ctx.textAlign = 'left';
  lx += 22;

  ctx.font = 'bold 17px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText('x ' + Game.coins, lx + 1, cy2 + 1);
  ctx.fillStyle = '#fff';
  ctx.fillText('x ' + Game.coins, lx, cy2);
  lx += 14 + ctx.measureText('x ' + Game.coins).width + 18;

  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText('分数 ' + Math.floor(Game.score), lx + 1, cy2 + 1);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText('分数 ' + Math.floor(Game.score), lx, cy2);

  // 追逐距离条
  const bw = Math.min(cw() * 0.5, 320);
  const bx = cw() - bw - pad;
  const by = pad + 4;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(bx - 2, by - 2, bw + 4, 16);
  const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  g.addColorStop(0, '#ff6b6b');
  g.addColorStop(1, '#80ed99');
  ctx.fillStyle = g;
  ctx.fillRect(bx, by, bw * (Game.gap / 100), 12);
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'right';
  ctx.fillText('😈', bx - 6, by - 3);
  ctx.textAlign = 'left';

  // 状态图标
  let iconY = pad + 30;
  const drawIcon = (t) => {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(bx - 20, iconY + 8, 14, 0, Math.PI * 2); ctx.fill();
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t, bx - 20, iconY + 9);
    iconY += 30;
  };
  if (player.shield) drawIcon('🛡');
  if (player.star) drawIcon('★');
  if (player.magnet) drawIcon('🧲');

  ctx.restore();
}

function drawParticles() {
  for (const p of Game.particles) {
    ctx.save();
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (1 - p.t / p.life * 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ---------------- 主循环 ---------------- */
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

})();