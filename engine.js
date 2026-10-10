/* Standalone circle-based merge simulation. Gameplay structure references
 * YHSome/BigNaiWa v1 (substeps, cooldown, per-body danger timer).
 * This implementation intentionally uses circular colliders for the MVP. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MergeGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LEVELS = [
    { name: '智谱', file: '06-black-z.webp', radius: 21, color: '#aaa9c6' },
    { name: 'MiniMax', file: '08-minimax.webp', radius: 27, color: '#ffad87' },
    { name: 'Meta', file: '10-white-ears.webp', radius: 34, color: '#e9ddd0' },
    { name: 'Qwen', file: '07-blue-hat.webp', radius: 41, color: '#9daeff' },
    { name: 'Mistral', file: '09-red-hat-cat.webp', radius: 49, color: '#ffa773' },
    { name: 'grok', file: '11-blonde-crown.webp', radius: 58, color: '#eac88f' },
    { name: 'Gemini', file: '05-gemini.webp', radius: 68, color: '#ba99ff' },
    { name: 'DS', file: '03-deepseek.webp', radius: 79, color: '#8dd9ff' },
    { name: 'GPT', file: '02-gpt.webp', radius: 91, color: '#d9cef7' },
    { name: 'Claude', file: '04-claude.webp', radius: 105, color: '#f7ac7c' },
    { name: '豆包', file: '01-doubao.webp', radius: 120, color: '#edcda9' }
  ].map((v, tier) => Object.freeze({ ...v, tier, level: tier + 1, score: tier ? 2 ** tier : 0 }));
  const CONFIG = Object.freeze({ width: 740, height: 495, wall: 14, floor: 479,
    dangerY: 112, dropY: 49, gravity: 1900, cooldown: .36, lossDelay: 1.5,
    restSpeed: 140, substeps: 3, iterations: 6, maxBonus: 2048 });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Another 10% above v2.1: 143% of the original usable area.
  function createBoardConfig(aspect = CONFIG.width / CONFIG.height) {
    aspect = clamp(aspect, .6, 2.5);
    const area = (420 - 28) * (624 - 112) * 1.3 * 1.1;
    const inset = CONFIG.dangerY + 16;
    const b = 2 * CONFIG.wall + inset * aspect;
    const height = (b + Math.sqrt(b * b + 4 * aspect * (area - 2 * CONFIG.wall * inset))) / (2 * aspect);
    return Object.freeze({ ...CONFIG, width: height * aspect, height, floor: height - 16 });
  }

  function fitViewport(width, height, config = CONFIG) {
    const scale = Math.min(width / config.width, height / config.height);
    return { scale, x: (width - config.width * scale) / 2, y: (height - config.height * scale) / 2 };
  }

  class World {
    constructor({ random = Math.random, config = CONFIG } = {}) { this.random = random; this.config = config; this.reset(); }
    reset() {
      this.balls = []; this.events = []; this.score = 0; this.mergeCount = 0;
      this.dropCount = 0; this.highestTier = 0; this.danger = 0; this.over = false;
      this.paused = false; this.time = 0; this.cooldown = 0; this.sequence = 0;
      this.generatedCount = 0;
      this.spawnRemaining = [2, 2, 0, 0];
      this.spawnLast = -1; this.spawnRun = 0;
      this.won = false; this.pending = this.pickTier(); this.next = this.pickTier();
    }
    pickTier() {
      // An opening bag of two pairs, then 10-piece bags with the original 4:3:2:1 mix.
      // Sample only new preview slots; never reroll something already shown.
      if (!this.spawnRemaining.some(n => n > 0)) this.spawnRemaining = [4, 3, 2, 1];
      const total = this.spawnRemaining.reduce((a, b) => a + b, 0);
      const candidates = [];
      for (let tier = 0; tier < 4; tier++) {
        if (!this.spawnRemaining[tier]) continue;
        const run = tier === this.spawnLast ? this.spawnRun + 1 : 1;
        if (run > 2) continue;
        // Leave enough separators to finish this bag without a triple at its tail.
        const possible = this.spawnRemaining.every((count, t) => {
          const left = count - (t === tier ? 1 : 0);
          const separators = total - 1 - left;
          return left <= 2 * separators + (t === tier ? 2 - run : 2);
        });
        if (possible) candidates.push(tier);
      }
      const weight = candidates.reduce((sum, tier) => sum + this.spawnRemaining[tier], 0);
      let ticket = this.random() * weight;
      let chosen = candidates[candidates.length - 1];
      for (const tier of candidates) {
        ticket -= this.spawnRemaining[tier];
        if (ticket < 0) { chosen = tier; break; }
      }
      this.spawnRemaining[chosen]--;
      this.spawnRun = chosen === this.spawnLast ? this.spawnRun + 1 : 1;
      this.spawnLast = chosen; this.generatedCount++;
      return chosen;
    }
    aimX(x, tier = this.pending) {
      const r = LEVELS[tier].radius;
      return clamp(x, this.config.wall + r, this.config.width - this.config.wall - r);
    }
    addBall(tier, x, y, overrides = {}) {
      if (!Number.isInteger(tier) || tier < 0 || tier >= LEVELS.length) throw new RangeError('Invalid tier');
      const r = LEVELS[tier].radius;
      const body = { id: ++this.sequence, tier, r, invMass: 1 / Math.pow(r, 1.5),
        x: this.aimX(x, tier), y: Math.min(y, this.config.floor - r), vx: 0, vy: 0,
        angle: 0, angularVelocity: 0, age: 0, landed: false, dangerTime: 0,
        dead: false, ...overrides };
      this.balls.push(body); return body;
    }
    drop(x) {
      if (this.over || this.paused || this.cooldown > 1e-7) return null;
      const ball = this.addBall(this.pending, this.aimX(x), this.config.dropY);
      this.highestTier = Math.max(this.highestTier, ball.tier);
      this.pending = this.next; this.next = this.pickTier();
      this.cooldown = this.config.cooldown; this.dropCount++;
      this.events.push({ type: 'drop', tier: ball.tier, x: ball.x, y: ball.y });
      return ball;
    }
    drainEvents() { return this.events.splice(0); }
    step(dt) {
      if (this.over || this.paused || !(dt > 0)) return;
      dt = Math.min(dt, 1 / 30);
      this.time += dt; this.cooldown = Math.max(0, this.cooldown - dt);
      for (const b of this.balls) b.pulseUsed = 0;
      const h = dt / this.config.substeps;
      for (let s = 0; s < this.config.substeps; s++) this.substep(h);
      this.checkGameOver(dt);
    }
    substep(h) {
      const spawned = [], pulses = [];
      for (const b of this.balls) {
        b.age += h; b.vy = clamp(b.vy + this.config.gravity * h, -700, 1150);
        b.vx = clamp(b.vx, -650, 650);
        b.vx *= Math.pow(.997, h * 60);
        // Apply rolling drag by elapsed time, never once per solver iteration.
        if (b.y + b.r >= this.config.floor - .1 && Math.abs(b.vy) < 80) b.vx *= Math.pow(.985, h * 60);
        b.x += b.vx * h; b.y += b.vy * h;
        b.angle += b.angularVelocity * h;
        b.angularVelocity *= Math.pow(.97, h * 60);
      }
      for (let iteration = 0; iteration < this.config.iterations; iteration++) {
        for (const b of this.balls) if (!b.dead) this.walls(b);
        for (let i = 0; i < this.balls.length; i++) {
          const a = this.balls[i]; if (a.dead) continue;
          for (let j = i + 1; j < this.balls.length; j++) {
            const b = this.balls[j]; if (a.dead || b.dead) continue;
            let dx = b.x - a.x, dy = b.y - a.y;
            if (Math.abs(dx) > a.r + b.r + .65 || Math.abs(dy) > a.r + b.r + .65) continue;
            const sum = a.r + b.r, distance2 = dx * dx + dy * dy;
            if (distance2 > (sum + .65) ** 2) continue;
            a.landed = b.landed = true;
            if (iteration === 0 && a.tier === b.tier) {
              a.dead = b.dead = true;
              const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
              pulses.push({ x, y, radius: LEVELS[Math.min(a.tier + 1, 10)].radius });
              this.mergeCount++;
              if (a.tier === LEVELS.length - 1) {
                this.score += this.config.maxBonus;
                this.events.push({ type: 'bonus', x, y, tier: a.tier, points: this.config.maxBonus });
              } else {
                const tier = a.tier + 1, points = LEVELS[tier].score;
                this.score += points; this.highestTier = Math.max(this.highestTier, tier);
                spawned.push({ tier, x, y, vx: (a.vx + b.vx) * .4, vy: Math.min(-95, (a.vy + b.vy) * .2) });
                this.events.push({ type: 'merge', x, y, tier, points });
                if (tier === LEVELS.length - 1 && !this.won) {
                  this.won = true; this.events.push({ type: 'milestone', tier });
                }
              }
              continue;
            }
            if (distance2 >= sum * sum) continue;
            let distance = Math.sqrt(distance2);
            if (distance < .0001) { dx = 1; dy = 0; distance = 1; }
            const nx = dx / distance, ny = dy / distance;
            const inverseSum = a.invMass + b.invMass;
            const correction = Math.max(0, sum - distance - .015) * .84 / inverseSum;
            a.x -= nx * correction * a.invMass; a.y -= ny * correction * a.invMass;
            b.x += nx * correction * b.invMass; b.y += ny * correction * b.invMass;
            const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
            const approach = rvx * nx + rvy * ny;
            if (approach < 0) {
              const restitution = iteration === 0 && approach < -90 ? .42 : 0;
              const impulse = -(1 + restitution) * approach / inverseSum;
              a.vx -= nx * impulse * a.invMass; a.vy -= ny * impulse * a.invMass;
              b.vx += nx * impulse * b.invMass; b.vy += ny * impulse * b.invMass;
              const tangent = rvx * -ny + rvy * nx;
              const friction = clamp(-tangent / inverseSum, -impulse * .045, impulse * .045);
              a.vx -= -ny * friction * a.invMass; a.vy -= nx * friction * a.invMass;
              b.vx += -ny * friction * b.invMass; b.vy += nx * friction * b.invMass;
              a.angularVelocity = clamp(a.vx / a.r * .32, -2, 2);
              b.angularVelocity = clamp(b.vx / b.r * .32, -2, 2);
            }
          }
        }
      }
      this.balls = this.balls.filter(b => !b.dead);
      for (const pulse of pulses) this.mergePulse(pulse);
      for (const p of spawned) {
        const lift = this.safeLift(p.y, LEVELS[p.tier].radius);
        this.addBall(p.tier, p.x, p.y, { vx: p.vx, vy: Math.max(p.vy, -lift), landed: true });
      }
      for (const b of this.balls) this.walls(b);
    }
    safeLift(y, radius) {
      const clearance = Math.max(0, y - radius - this.config.dangerY - 14);
      return Math.min(220, Math.sqrt(2 * this.config.gravity * clearance));
    }
    mergePulse({ x, y, radius }) {
      for (const b of this.balls) {
        const dx = b.x - x, dy = b.y - y, distance = Math.hypot(dx, dy);
        const reach = radius + b.r + 100;
        if (distance >= reach) continue;
        const remaining = Math.max(0, 130 - (b.pulseUsed || 0));
        const strength = Math.min(remaining, (165 + radius * .5) * Math.pow(1 - distance / reach, 1.15) * clamp(Math.sqrt(radius / b.r), .6, 1.25));
        b.pulseUsed = (b.pulseUsed || 0) + strength;
        const nx = distance > .01 ? dx / distance : (b.id % 2 ? 1 : -1);
        const ny = distance > .01 ? dy / distance : 0;
        b.vx = clamp(b.vx + nx * strength, -650, 650);
        // Limit additional lift near the danger line; never cancel pre-existing motion.
        const kickY = Math.max(ny * strength * .5 - strength * .4, -Math.max(0, this.safeLift(b.y, b.r) + b.vy));
        b.vy = clamp(b.vy + kickY, -700, 1150);
        b.angularVelocity = clamp(b.angularVelocity + nx * strength / b.r * .3, -2, 2);
      }
    }
    walls(b) {
      const left = this.config.wall + b.r, right = this.config.width - this.config.wall - b.r;
      if (b.x < left) { b.x = left; if (b.vx < 0) b.vx *= -.32; }
      if (b.x > right) { b.x = right; if (b.vx > 0) b.vx *= -.32; }
      if (b.y + b.r >= this.config.floor) {
        b.y = this.config.floor - b.r;
        if (b.vy > 0) b.vy = b.vy > 90 ? -b.vy * .32 : 0;
        b.landed = true;
      }
    }
    checkGameOver(dt) {
      this.danger = 0;
      for (const b of this.balls) {
        if (!b.landed || b.age < .25) continue;
        const overLine = b.y - b.r < this.config.dangerY;
        const resting = Math.hypot(b.vx, b.vy) < this.config.restSpeed;
        b.dangerTime = overLine && resting ? b.dangerTime + dt : Math.max(0, b.dangerTime - 2 * dt);
        this.danger = Math.max(this.danger, b.dangerTime / this.config.lossDelay);
        if (b.dangerTime + 1e-8 >= this.config.lossDelay) {
          this.over = true; this.events.push({ type: 'gameover', score: this.score }); return;
        }
      }
    }
  }
  return { LEVELS, CONFIG, World, clamp, createBoardConfig, fitViewport };
});
