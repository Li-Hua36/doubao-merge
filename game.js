(function () {
  'use strict';
  const { LEVELS, World, clamp, createBoardConfig, fitViewport } = window.MergeGame;
  const C = createBoardConfig(420 / 640);
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d', { alpha: true });
  const world = new World({ config: C }), images = [], spriteCache = [];
  $('stage').style.aspectRatio = `${C.width} / ${C.height}`;
  $('stage').style.width = '100%';
  const storage = { get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* game remains available */ } } };
  let best = Math.max(0, Number(storage.get('doubao.best.v1', 0)) || 0);
  let roundBestAtStart = best, loaded = false, aim = C.width / 2, pointer = null;
  let particles = [], floats = [], rings = [], toastTimer, lastTime = 0, accumulator = 0;
  let modalWasPaused = false, lastScore = -1, lastHighest = -1, lastPending = -1;
  let lastStatus = '', lastNext = -1, failed = [], viewport = { scale: 1, x: 0, y: 0 };
  let renderOrder = [], orderDirty = true, needsRender = true, lastRenderTime = -Infinity, lastHudTime = -Infinity;
  let previousDangerVisible, previousDangerClass;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const achievementQueue = [];
  let achievementShowing = false, achievementFilter = 'earned';
  const achievements = new window.MergeAchievements.Tracker({
    storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
    onUnlock(achievement) {
      achievementQueue.push(achievement); updateAchievements(); showNextAchievement();
    }
  });
  function achievementIcon(a) {
    return a.tier === null ? '<svg aria-hidden="true"><use href="#i-cup"/></svg>' : `<img src="assets/heads/${LEVELS[a.tier].file}" alt="">`;
  }
  function showNextAchievement() {
    if (achievementShowing || !achievementQueue.length) return;
    achievementShowing = true;
    const a = achievementQueue.shift(), toast = $('achievementToast');
    $('achievementToastIcon').innerHTML = achievementIcon(a);
    $('achievementToastName').textContent = a.name;
    $('achievementToastRequirement').textContent = a.description;
    toast.hidden = false;
    if (toast.showPopover) { try { toast.showPopover(); } catch {} }
    else {
      // Older browsers need the notification inside an open modal to stay visible.
      (document.querySelector('dialog[open]') || document.body).appendChild(toast);
    }
    void toast.offsetWidth; toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.hidePopover) { try { toast.hidePopover(); } catch {} }
        toast.hidden = true; achievementShowing = false; showNextAchievement();
      }, reducedMotion ? 0 : 240);
    }, a.description.length > 35 ? 7000 : 5500);
  }
  function updateAchievements() {
    const total = window.MergeAchievements.DEFINITIONS.length;
    $('achievementCount').textContent = `${achievements.count}/${total}`;
    $('achievementButton').setAttribute('aria-label', `查看成就，已获得 ${achievements.count} 项，共 ${total} 项`);
    $('achievementSummary').textContent = `已获得 ${achievements.count} / ${total} 项成就`;
    $('achievementStorage').textContent = achievements.storageAvailable
      ? '成就保存在当前浏览器。重新开始会保留记录；清除浏览器数据或更换访问地址可能失去记录。'
      : '浏览器暂时无法保存成就，本次打开期间仍可查看；关闭页面后记录可能丢失。';
    $('earnedTab').setAttribute('aria-pressed', String(achievementFilter === 'earned'));
    $('allTab').setAttribute('aria-pressed', String(achievementFilter === 'all'));
    const items = window.MergeAchievements.DEFINITIONS.filter(a => achievementFilter === 'all' || achievements.has(a.id));
    $('achievementEmpty').hidden = items.length > 0;
    $('achievementList').innerHTML = items.map(a => {
      const earned = achievements.has(a.id);
      const date = earned ? new Date(achievements.unlocked[a.id]).toLocaleDateString('zh-CN') : '';
      return `<li class="achievement-row ${earned ? 'earned' : 'locked'}"><span class="achievement-icon">${achievementIcon(a)}</span><div class="achievement-copy"><strong>${a.name}</strong><p>${a.description}</p><small>${earned ? '已解锁 · ' + date : '尚未解锁'}</small></div></li>`;
    }).join('');
  }
  function openAchievements() { achievementFilter = 'earned'; updateAchievements(); openDialog('achievementDialog'); }
  const sound = {
    context: null, muted: storage.get('doubao.muted.v1', '0') === '1',
    unlock() { if (this.muted) return; try { this.context ??= new (window.AudioContext || window.webkitAudioContext)(); if (this.context.state === 'suspended') this.context.resume().catch(() => {}); } catch {} },
    tone(freq, end, duration, volume = .06, delay = 0) {
      if (this.muted) return; this.unlock(); const ac = this.context; if (!ac || ac.state !== 'running') return;
      const osc = ac.createOscillator(), gain = ac.createGain(), t = ac.currentTime + delay;
      osc.type = 'sine'; osc.frequency.setValueAtTime(freq, t); osc.frequency.exponentialRampToValueAtTime(end, t + duration);
      gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(volume, t + .01); gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
      osc.connect(gain); gain.connect(ac.destination); osc.start(t); osc.stop(t + duration + .03);
    },
    drop() { this.tone(270, 170, .08, .03); },
    merge(tier) { const f = 300 * 2 ** (tier / 12); this.tone(f, f * 1.5, .16, .06); this.tone(f * 2, f * 2, .14, .02, .06); },
    over() { this.tone(330, 130, .6, .045); },
    bonus() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, .25, .055, i * .1)); }
  };
  function soundUI() { $('soundButton').classList.toggle('muted', sound.muted); $('soundButton').setAttribute('aria-pressed', String(!sound.muted)); $('soundButton').setAttribute('aria-label', sound.muted ? '开启音效' : '关闭音效'); }
  function buildCollection() {
    $('levelGrid').innerHTML = LEVELS.map((l, i) => `<div class="level-item" data-level="${i + 1}"><figure><img loading="lazy" decoding="async" src="assets/heads/${l.file}" alt="第${i + 1}级 ${l.name}"><span class="level-number">${String(i + 1).padStart(2, '0')}</span></figure><span class="level-name">${l.name}</span></div>`).join('');
  }
  async function loadImage(i) {
    const img = new Image(); img.decoding = 'async';
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = 'assets/heads/' + LEVELS[i].file; });
    if (img.decode) await img.decode();
    const cache = document.createElement('canvas');
    cache.width = cache.height = Math.ceil(LEVELS[i].radius * 4.5);
    const scale = Math.min(cache.width / img.naturalWidth, cache.height / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    cache.getContext('2d').drawImage(img, (cache.width - w) / 2, (cache.height - h) / 2, w, h); spriteCache[i] = cache; images[i] = true;
  }
  async function load() {
    $('retryButton').hidden = true; failed = []; let done = images.filter(Boolean).length;
    const update = () => { $('loadText').textContent = `${done} / 11`; $('loadProgress').style.width = `${done / 11 * 100}%`; };
    update();
    const queue = LEVELS.map((_, i) => i).filter(i => !images[i]);
    await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) { const i = queue.shift(); try { await loadImage(i); done++; update(); } catch { failed.push(i); } } }));
    if (failed.length) { $('loadText').textContent = `${failed.length} 位伙伴暂时没赶到，请重试`; $('retryButton').hidden = false; return; }
    loaded = true; $('loading').hidden = true; $('pauseButton').disabled = $('restartButton').disabled = false;
    updateHUD(true); resize();
  }
  function resize() {
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(box.width * dpr), h = Math.round(box.height * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    viewport = fitViewport(canvas.width, canvas.height, C); render();
  }
  function viewportChanged() {
    const height = window.visualViewport?.height || window.innerHeight;
    if (height) document.documentElement.style.setProperty('--viewport-height', `${height}px`);
    needsRender = true; resize();
  }
  function updateHUD(force = false) {
    if (force || lastScore !== world.score) {
      $('score').textContent = world.score.toLocaleString('en-US');
      if (lastScore >= 0 && world.score > lastScore && !reducedMotion) { $('score').classList.remove('bump'); void $('score').offsetWidth; $('score').classList.add('bump'); }
      if (world.score > best) { best = world.score; storage.set('doubao.best.v1', best); }
      $('best').textContent = best.toLocaleString('en-US'); lastScore = world.score;
    }
    if (force || lastNext !== world.next) {
      $('nextImage').src = 'assets/heads/' + LEVELS[world.next].file;
      $('nextImage').alt = `下一位：第${world.next + 1}级 ${LEVELS[world.next].name}`;
      $('nextLevel').textContent = String(world.next + 1).padStart(2, '0'); lastNext = world.next;
    }
    if (force || lastHighest !== world.highestTier) {
      const l = LEVELS[world.highestTier]; $('highestImage').src = 'assets/heads/' + l.file;
      $('highestName').textContent = l.name; $('highestLevel').textContent = `LEVEL ${String(l.level).padStart(2, '0')} / 11`;
      $('levelProgress').style.width = (l.level / 11 * 100) + '%';
      document.querySelectorAll('.level-item').forEach((item, i) => { item.classList.toggle('reached', i <= world.highestTier); item.classList.toggle('current', i === world.highestTier); });
      lastHighest = world.highestTier;
    }
    if (lastPending !== world.pending) { aim = world.aimX(aim); lastPending = world.pending; }
    const status = !loaded ? '正在准备伙伴…' : world.over ? '这一局，收获满满' : world.paused ? '暂停中 · 伙伴们在等你' : world.cooldown > 0 ? '稍等一下，正在落下' : '准备好，就放手吧';
    if (status !== lastStatus) { $('statusLabel').textContent = status; $('statusDot').style.background = world.over ? '#f2b8b3' : world.paused ? '#dac69e' : '#9fe3c6'; lastStatus = status; }
    const visible = world.danger >= .22 && !world.over, warning = world.danger > .2 && !world.over;
    if (visible !== previousDangerVisible) { $('dangerMessage').hidden = !visible; previousDangerVisible = visible; }
    if (warning !== previousDangerClass) { $('stage').classList.toggle('danger', warning); previousDangerClass = warning; }
  }
  function message(text, duration = 2300) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.add('show'); toastTimer = setTimeout(() => $('toast').classList.remove('show'), duration); }
  function burst(event) {
    const { x, y, tier, points } = event;
    const color = LEVELS[tier].color;
    if (!reducedMotion) {
      rings.push({ x, y, radius: LEVELS[tier].radius * .6, age: 0, color });
      for (let i = 0; i < 11; i++) { const a = i / 11 * Math.PI * 2; particles.push({ x, y, vx: Math.cos(a) * (50 + Math.random() * 75), vy: Math.sin(a) * (60 + Math.random() * 60), age: 0, life: .45 + Math.random() * .2, color, r: 1.5 + Math.random() * 2 }); }
    }
    floats.push({ x, y, text: `+${points}`, age: 0, color });
    if (particles.length > 160) particles.splice(0, particles.length - 160);
    if (rings.length > 20) rings.splice(0, rings.length - 20);
    if (floats.length > 24) floats.splice(0, floats.length - 24);
  }
  function processEvents() {
    let mergeSound = -1;
    const events = world.drainEvents();
    if (events.length) { orderDirty = needsRender = true; }
    for (const event of events) {
      if (event.type === 'drop') sound.drop();
      if (event.type === 'merge') { burst(event); mergeSound = Math.max(mergeSound, event.tier); }
      if (event.type === 'bonus') { burst(event); sound.bonus(); message('双份豆包！+2048 分，继续合成'); }
      if (event.type === 'milestone') { sound.bonus(); message('终于遇见你，大豆包！继续挑战吧 ✦', 3600); }
      if (event.type === 'gameover') gameOver();
    }
    if (mergeSound >= 0) sound.merge(mergeSound);
    achievements.events(events);
    if (events.length) updateHUD();
  }
  function fxStep(dt) {
    particles = particles.filter(p => p.age < p.life); for (const p of particles) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 130 * dt; }
    floats = floats.filter(p => p.age < .9); floats.forEach(p => p.age += dt);
    rings = rings.filter(p => p.age < .4); rings.forEach(p => p.age += dt);
  }
  function drawHead(tier, x, y, radius, angle = 0, opacity = 1, scale = 1) {
    const image = spriteCache[tier]; if (!image) return;
    ctx.save(); ctx.globalAlpha = opacity; ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
    const size = radius * 2.16; ctx.drawImage(image, -size / 2, -size / 2, size, size); ctx.restore();
  }
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);
    const bottom = ctx.createLinearGradient(0, 290, 0, C.height); bottom.addColorStop(0, '#ab94ed00'); bottom.addColorStop(1, '#b7b2ff0a'); ctx.fillStyle = bottom; ctx.fillRect(0, 0, C.width, C.height);
    ctx.strokeStyle = '#cbd9ef18'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(C.wall, 140); ctx.lineTo(C.wall, C.floor); ctx.lineTo(C.width - C.wall, C.floor); ctx.lineTo(C.width - C.wall, 140); ctx.stroke();
    ctx.fillStyle = '#e1dcff0d'; ctx.fillRect(C.wall, C.floor, C.width - 2 * C.wall, 3);
    ctx.save(); ctx.setLineDash([5, 7]); ctx.strokeStyle = world.danger > .15 ? `rgba(252,151,166,${.55 + .25 * Math.sin(world.time * 12)})` : '#d3bba152'; ctx.beginPath(); ctx.moveTo(C.wall + 2, C.dangerY); ctx.lineTo(C.width - C.wall - 2, C.dangerY); ctx.stroke(); ctx.restore();
    ctx.font = '9px "Microsoft YaHei", sans-serif'; ctx.fillStyle = world.danger > .15 ? '#f2a8b3' : '#b7ac9b85'; ctx.textAlign = 'right'; ctx.fillText('警 戒 线', C.width - C.wall - 3, C.dangerY - 9);
    if (loaded && !world.over) {
      const radius = LEVELS[world.pending].radius, x = world.aimX(aim);
      let landingY = C.floor - radius;
      for (const b of world.balls) { const dx = b.x - x, reach = b.r + radius; if (Math.abs(dx) < reach) { const top = b.y - Math.sqrt(reach * reach - dx * dx); if (top > C.dropY && top < landingY) landingY = top; } }
      if (world.cooldown <= 0 && !world.paused) {
        ctx.save(); ctx.strokeStyle = '#b8edda31'; ctx.setLineDash([2, 7]); ctx.beginPath(); ctx.moveTo(x, C.dropY + radius + 7); ctx.lineTo(x, landingY); ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = '#b8edda3d'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, Math.min(C.floor - 2, landingY + radius), 9, 2.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      drawHead(world.pending, x, C.dropY, radius, 0, world.cooldown > 0 ? .25 : .92);
      if (world.cooldown > 0) { ctx.save(); ctx.strokeStyle = '#beeed768'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, C.dropY, radius + 6, -Math.PI / 2, -Math.PI / 2 + (1 - world.cooldown / C.cooldown) * 2 * Math.PI); ctx.stroke(); ctx.restore(); }
    }
    if (!world.balls.length && loaded) {
      ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = '#b9c4e422'; ctx.font = '30px serif'; ctx.fillText('✦', C.width / 2, C.height / 2); ctx.font = '11px "Microsoft YaHei", sans-serif'; ctx.fillStyle = '#a2b2ca4b'; ctx.fillText('让第一位伙伴落下来', C.width / 2, C.height / 2 + 32); ctx.restore();
    }
    if (orderDirty) { renderOrder = [...world.balls].sort((a, b) => a.r - b.r); orderDirty = false; }
    for (const b of renderOrder) {
      const pop = !reducedMotion && b.age < .18 ? 1 + Math.sin(b.age / .18 * Math.PI) * .045 : 1;
      drawHead(b.tier, b.x, b.y, b.r, b.angle, 1, pop);
    }
    for (const ring of rings) { ctx.save(); ctx.globalAlpha = (1 - ring.age / .4) * .45; ctx.strokeStyle = ring.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ring.x, ring.y, ring.radius + ring.age * 95, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    for (const p of particles) { ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p.age / p.life); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    for (const p of floats) { ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p.age / .9); ctx.fillStyle = p.color; ctx.font = '600 17px "Segoe UI",sans-serif'; ctx.textAlign = 'center'; ctx.shadowColor = '#152038'; ctx.shadowBlur = 7; ctx.fillText(p.text, p.x, p.y - 12 - p.age * 45); ctx.restore(); }
  }
  function frame(time) {
    const dt = Math.min((time - (lastTime || time)) / 1000, .06); lastTime = time;
    if (loaded && !world.paused && !world.over) {
      accumulator += dt;
      while (accumulator >= 1 / 60) { world.step(1 / 60); processEvents(); achievements.update(world, 1 / 60); accumulator -= 1 / 60; if (world.over) { accumulator = 0; break; } }
      fxStep(dt);
    } else accumulator = 0;
    if (time - lastHudTime >= 100) { updateHUD(); lastHudTime = time; }
    if ((loaded && !world.paused && !world.over || needsRender) && time - lastRenderTime >= 1000 / 60 - .5) {
      render(); needsRender = false; lastRenderTime = time;
    }
    requestAnimationFrame(frame);
  }
  function setPaused(value) {
    if (!loaded || world.over) return;
    world.paused = value; pointer = null;
    needsRender = true;
    $('pauseScreen').hidden = !value || !!document.querySelector('dialog[open]');
    $('pauseButton').setAttribute('aria-label', value ? '继续游戏' : '暂停游戏');
    $('pauseButton').innerHTML = `<svg><use href="#i-${value ? 'play' : 'pause'}"/></svg>`;
    updateHUD();
  }
  function openDialog(id) {
    const current = document.querySelector('dialog[open]');
    if (current && !(id === 'achievementDialog' && current.id === 'overDialog' && !$('achievementDialog').open)) return;
    modalWasPaused = world.paused; if (!world.over) world.paused = true;
    pointer = null; $(id).showModal(); $('pauseScreen').hidden = true; updateHUD();
    raiseAchievementToast();
  }
  function raiseAchievementToast() {
    if (!achievementShowing) return;
    const toast = $('achievementToast');
    if (toast.hidePopover && toast.showPopover) { try { toast.hidePopover(); toast.showPopover(); } catch {} }
    else (document.querySelector('dialog[open]') || document.body).appendChild(toast);
  }
  function reset() {
    document.querySelectorAll('dialog[open]').forEach(d => { d.dataset.skipResume = '1'; d.close(); });
    world.reset(); achievements.resetRound(); particles = []; floats = []; rings = []; pointer = null; aim = C.width / 2; accumulator = 0;
    orderDirty = needsRender = true;
    roundBestAtStart = best; lastScore = -1; lastHighest = -1; $('toast').classList.remove('show'); clearTimeout(toastTimer);
    $('pauseScreen').hidden = true; $('pauseButton').disabled = false; setPaused(false); updateHUD(true); sound.unlock();
  }
  function gameOver() {
    pointer = null; sound.over(); updateHUD();
    const l = LEVELS[world.highestTier]; $('endImage').src = 'assets/heads/' + l.file;
    $('endScore').textContent = world.score.toLocaleString('en-US'); $('endMerges').textContent = world.mergeCount;
    $('endLevel').textContent = String(l.level).padStart(2, '0'); $('endCaption').textContent = `这一局，你遇见了${l.name}。下一局会更近一点。`;
    $('endBest').textContent = world.score > roundBestAtStart ? '✦ 刷新了你的本机最高分' : `本机最高 ${best.toLocaleString('en-US')}`;
    $('endEyebrow').textContent = world.score > roundBestAtStart ? 'A NEW PERSONAL BEST' : 'A LOVELY LITTLE RUN';
    $('pauseButton').disabled = true; $('pauseScreen').hidden = true; $('overDialog').showModal();
    raiseAchievementToast();
  }
  function pointerX(event) { const r = canvas.getBoundingClientRect(); return ((event.clientX - r.left) * canvas.width / r.width - viewport.x) / viewport.scale; }
  function drop() { if (!loaded) return; sound.unlock(); const b = world.drop(aim); if (b) { processEvents(); updateHUD(); } }
  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button > 0 || !loaded || world.paused || world.over) return;
    event.preventDefault(); sound.unlock(); aim = world.aimX(pointerX(event)); pointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', event => { if (!loaded || world.over || world.paused) return; if (event.pointerType === 'mouse' || pointer === event.pointerId) aim = world.aimX(pointerX(event)); });
  canvas.addEventListener('pointerup', event => {
    if (pointer !== event.pointerId) return;
    event.preventDefault(); aim = world.aimX(pointerX(event)); pointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); drop();
  });
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  canvas.addEventListener('lostpointercapture', () => { pointer = null; });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  document.addEventListener('keydown', event => {
    if (!loaded || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|BUTTON|SELECT/.test(event.target.tagName)) return;
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); if (!world.paused && !world.over) aim = world.aimX(aim + (event.code === 'ArrowLeft' ? -12 : 12)); }
    if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); if (!event.repeat) drop(); }
    if (event.code === 'KeyP' && !event.repeat) setPaused(!world.paused);
  });
  $('pauseButton').onclick = () => setPaused(!world.paused);
  $('resumeButton').onclick = () => { sound.unlock(); setPaused(false); canvas.focus({ preventScroll: true }); };
  $('soundButton').onclick = () => { sound.muted = !sound.muted; storage.set('doubao.muted.v1', sound.muted ? '1' : '0'); soundUI(); if (!sound.muted) sound.tone(540, 650, .15, .03); };
  $('helpButton').onclick = () => openDialog('helpDialog');
  $('achievementButton').onclick = $('endAchievementButton').onclick = openAchievements;
  $('earnedTab').onclick = () => { achievementFilter = 'earned'; updateAchievements(); };
  $('allTab').onclick = () => { achievementFilter = 'all'; updateAchievements(); };
  $('restartButton').onclick = () => { if (world.dropCount) openDialog('resetDialog'); else reset(); };
  $('confirmReset').onclick = reset; $('playAgain').onclick = reset; $('retryButton').onclick = load;
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());
  ['helpDialog', 'resetDialog', 'achievementDialog'].forEach(id => $(id).addEventListener('close', () => { raiseAchievementToast(); if ($(id).dataset.skipResume) { delete $(id).dataset.skipResume; return; } if (!world.over) { world.paused = modalWasPaused; setPaused(modalWasPaused); } }));
  $('overDialog').addEventListener('cancel', event => event.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.hidden && loaded && !world.over && !document.querySelector('dialog[open]')) setPaused(true); });
  window.addEventListener('blur', () => { pointer = null; });
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('stage'));
  window.addEventListener('resize', viewportChanged);
  window.visualViewport?.addEventListener('resize', viewportChanged);
  if (matchMedia('(pointer:fine)').matches) $('controlHint').innerHTML = '<span class="gesture-dot"></span>移动瞄准 · 点击投放';
  buildCollection(); updateAchievements(); soundUI(); updateHUD(true); viewportChanged(); load(); requestAnimationFrame(frame);
  if (new URLSearchParams(location.search).has('debug')) window.__MERGE_DEBUG__ = { world, achievements, render, reset, updateHUD, processEvents, get loaded() { return loaded; } };
})();
