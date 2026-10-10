(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MergeAchievements = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STORAGE_KEY = 'doubao.achievements.v1';
  const DEFINITIONS = Object.freeze([
    { id: 'doubao', name: '稳稳接住', tier: 10, description: '成功合成豆包。' },
    { id: 'risk', name: '您的帐号已被风控', tier: 9, description: 'Claude 与至少 4 种不同国产模型同场，保持 1 秒。国产模型：智谱、MiniMax、Qwen、DS、豆包。' },
    { id: 'zhipu', name: '数据窃取中......', tier: 0, description: '场上同时存在至少 5 个智谱，保持 1 秒。' },
    { id: 'agree', name: '你说得对', tier: 8, description: '同一个 GPT 同时接触至少 3 种其他角色，保持 1 秒。' },
    { id: 'llama', name: '羊驼开会', tier: 2, description: '场上同时存在至少 3 个 Meta，保持 1 秒。' },
    { id: 'twins', name: '双子星', tier: 6, description: '同一对 Gemini 同时在场，保持 2 秒。' },
    { id: 'trio', name: '御三家会谈', tier: 8, description: 'GPT、Claude、Gemini 同时在场，保持 1 秒。' },
    { id: 'context', name: '上下文窗口已满', tier: null, description: '首次因堆叠超线而结束游戏。' },
    { id: 'hundred', name: '百模大战', tier: null, description: '场上同时存在至少 8 种不同角色，保持 1 秒。' },
    { id: 'busy', name: '服务器繁忙，请稍后再试', tier: 7, description: '首次成功合成 DS。' }
  ].map(Object.freeze));
  const byId = new Map(DEFINITIONS.map(a => [a.id, a]));

  class Tracker {
    constructor({ storage, onUnlock = () => {}, now = Date.now } = {}) {
      this.storage = storage; this.onUnlock = onUnlock; this.now = now;
      this.unlocked = Object.create(null); this.holds = new Map(); this.storageAvailable = true;
      try {
        const record = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
        if (record?.version === 1 && record.unlocked && typeof record.unlocked === 'object') {
          for (const a of DEFINITIONS) {
            const at = record.unlocked[a.id];
            if (Number.isFinite(at) && at > 0 && at <= 8640000000000000) this.unlocked[a.id] = at;
          }
        }
      } catch { this.storageAvailable = false; }
    }
    has(id) { return Object.prototype.hasOwnProperty.call(this.unlocked, id); }
    get count() { return Object.keys(this.unlocked).length; }
    unlock(id) {
      if (!byId.has(id) || this.has(id)) return;
      this.unlocked[id] = this.now();
      try {
        this.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, unlocked: this.unlocked }));
        this.storageAvailable = !!this.storage;
      } catch { this.storageAvailable = false; }
      this.onUnlock(byId.get(id));
    }
    events(events) {
      for (const event of events) {
        if (event.type === 'merge' && event.tier === 10) this.unlock('doubao');
        if (event.type === 'merge' && event.tier === 7) this.unlock('busy');
        if (event.type === 'gameover') this.unlock('context');
      }
    }
    resetRound() { this.holds.clear(); }
    update(world, dt) {
      if (world.paused || world.over || !(dt > 0)) return;
      const balls = world.balls.filter(b => !b.dead);
      const counts = Array(11).fill(0);
      for (const b of balls) counts[b.tier]++;
      const active = new Set();
      const hold = (id, condition, seconds = 1, identity = id) => {
        if (this.has(id) || !condition) return;
        const key = id + ':' + identity; active.add(key);
        const time = (this.holds.get(key) || 0) + dt;
        this.holds.set(key, time);
        if (time + 1e-8 >= seconds) this.unlock(id);
      };
      hold('risk', counts[9] > 0 && [0, 1, 3, 7, 10].filter(t => counts[t] > 0).length >= 4);
      hold('zhipu', counts[0] >= 5);
      hold('llama', counts[2] >= 3);
      hold('trio', counts[8] > 0 && counts[9] > 0 && counts[6] > 0);
      hold('hundred', counts.filter(n => n > 0).length >= 8);
      if (!this.has('twins')) {
        const twins = balls.filter(b => b.tier === 6);
        for (let i = 0; i < twins.length; i++) for (let j = i + 1; j < twins.length; j++) {
          const ids = [twins[i].id, twins[j].id].sort((a, b) => a - b);
          hold('twins', true, 2, ids.join('-'));
        }
      }
      if (!this.has('agree')) for (const gpt of balls.filter(b => b.tier === 8)) {
        const neighbors = new Set();
        for (const b of balls) {
          // Match the circle solver's contact tolerance, without changing its bodies.
          if (b.tier !== 8 && (b.x - gpt.x) ** 2 + (b.y - gpt.y) ** 2 <= (b.r + gpt.r + .65) ** 2) neighbors.add(b.tier);
        }
        hold('agree', neighbors.size >= 3, 1, gpt.id);
      }
      for (const key of this.holds.keys()) if (!active.has(key)) this.holds.delete(key);
    }
  }
  return { DEFINITIONS, STORAGE_KEY, Tracker };
});
