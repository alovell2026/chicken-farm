const canvas = document.getElementById('farmCanvas');
const ctx = canvas.getContext('2d');

// Tiny generated WAVs keep the game self-contained: no downloads or external audio files needed.
function toneDataUri(frequency, seconds, secondFrequency = null) {
  const rate = 8000, count = Math.floor(rate * seconds), bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const write = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) { const progress = i / count; const frequencyNow = secondFrequency ? frequency + (secondFrequency - frequency) * progress : frequency; const envelope = Math.min(1, i / 120) * Math.min(1, (count - i) / 900); view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * frequencyNow * i / rate) * 11500 * envelope, true); }
  const bytesArray = new Uint8Array(bytes); let binary = ''; for (const byte of bytesArray) binary += String.fromCharCode(byte); return `data:audio/wav;base64,${btoa(binary)}`;
}
function noiseDataUri(seconds) {
  const rate = 8000, count = Math.floor(rate * seconds), bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const write = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) { const fade = Math.min(1, i / 500) * Math.min(1, (count - i) / 500); view.setInt16(44 + i * 2, (Math.random() * 2 - 1) * 1800 * fade, true); }
  const bytesArray = new Uint8Array(bytes); let binary = ''; for (const byte of bytesArray) binary += String.fromCharCode(byte); return `data:audio/wav;base64,${btoa(binary)}`;
}
const sounds = {
  arrive: new Audio(toneDataUri(620, .12)), rooster: new Audio(toneDataUri(330, .22, 470)), egg: new Audio(toneDataUri(780, .14, 940)),
  feed: new Audio(toneDataUri(1040, .16)), death: new Audio(toneDataUri(180, .28, 110)), levelUp: new Audio(toneDataUri(560, .36, 900)),
  breakdown: new Audio(toneDataUri(145, .20, 80)), rain: new Audio(noiseDataUri(1.2))
};
Object.values(sounds).forEach(sound => { sound.volume = .28; sound.preload = 'auto'; }); sounds.rooster.volume = .34; sounds.levelUp.volume = .32; sounds.rain.volume = .10; sounds.rain.loop = true;
function playSound(sound) { sound.currentTime = 0; sound.play().catch(() => {}); }
function startRainSound() { if (sounds.rain.paused) sounds.rain.play().catch(() => {}); }
function stopRainSound() { sounds.rain.pause(); sounds.rain.currentTime = 0; }
const ui = {
  servers: document.getElementById('servers'), serversValue: document.getElementById('serversValue'), linePreview: document.getElementById('linePreview'),
  start: document.getElementById('startButton'), pause: document.getElementById('pauseButton'), reset: document.getElementById('resetButton'),
  served: document.getElementById('servedCount'), died: document.getElementById('diedCount'), money: document.getElementById('moneySpent'), score: document.getElementById('score'),
  levelBadge: document.getElementById('levelBadge'), levelNumber: document.getElementById('levelNumber'), goal: document.getElementById('goalText'), deathLimit: document.getElementById('deathLimitText'), budgetLeft: document.getElementById('budgetLeft'), timeLeft: document.getElementById('timeLeft'), status: document.getElementById('levelStatus'), clock: document.getElementById('simulationClock'), streak: document.getElementById('streakText'), event: document.getElementById('eventText')
};

const kidMode = true;
const DEATH_WAIT = kidMode ? 15 : 10;
const levels = [
  { target: 15, maxDeaths: 2, budget: 90, time: 60, arrival: 0.85, events: 0.08, pattern: 'steady' },
  { target: 25, maxDeaths: 3, budget: 150, time: 75, arrival: 1.15, events: 0.12, pattern: 'fast' },
  { target: 40, maxDeaths: 5, budget: 240, time: 90, arrival: 1.25, events: 0.18, pattern: 'mixed' },
  { target: 60, maxDeaths: 8, budget: 380, time: 110, arrival: 1.45, events: 0.26, pattern: 'chaotic' }
];
let levelIndex = 0, running = false, paused = false, lastFrame = 0, accumulator = 0;
let simTime = 0, levelStartTime = 0, nextArrival = 0, nextEvent = 0, chickens = [], queue = [], servers = [];
let served = 0, died = 0, levelServed = 0, levelDied = 0, moneySpent = 0, score = 0, streak = 0, currentEvent = null, outcome = null, levelUpUntil = 0;

function level() { return levels[levelIndex]; }
function serverCount() { return Number(ui.servers.value); }
function exponential(rate) { return -Math.log(1 - Math.random()) / Math.max(.05, rate); }
function refreshControls() { ui.serversValue.textContent = serverCount(); ui.linePreview.textContent = '🐔 '.repeat(serverCount()).trim(); }
function setStatus(text, kind = 'neutral') { ui.status.textContent = text; ui.status.className = `status-box ${kind}`; }
function arrivalRate() {
  const l = level();
  if (l.pattern === 'steady' || l.pattern === 'fast') return l.arrival;
  const wave = 1 + Math.max(0, Math.sin(simTime / (l.pattern === 'chaotic' ? 5 : 9))) * (l.pattern === 'chaotic' ? .8 : .7);
  return l.arrival * (kidMode ? .8 : 1);
}
function feedingRate() { return .78 * (currentEvent && currentEvent.type === 'rain' ? .52 : 1); }
function updateLevelPanel() {
  const l = level(); ui.levelBadge.textContent = `LEVEL ${levelIndex + 1}`; ui.levelNumber.textContent = levelIndex + 1; ui.goal.textContent = `Serve ${l.target} chickens`; ui.deathLimit.textContent = l.maxDeaths; ui.budgetLeft.textContent = `$${Math.max(0, l.budget - moneySpent).toFixed(0)}`; ui.timeLeft.textContent = `${Math.max(0, l.time - (simTime - levelStartTime)).toFixed(0)} s`;
}
function resetLevel() {
  stopRainSound();
  running = false; paused = false; outcome = null; simTime = 0; levelStartTime = 0; accumulator = 0; nextArrival = 0; nextEvent = 12; chickens = []; queue = []; servers = Array.from({ length: serverCount() }, (_, i) => createServer(i)); served = 0; died = 0; levelServed = 0; levelDied = 0; moneySpent = 0; currentEvent = null; score = 0; streak = 0; levelUpUntil = 0;
  ui.start.disabled = false; ui.start.textContent = 'Start Level'; ui.pause.disabled = true; ui.pause.textContent = 'Pause'; setStatus('Pick some feeding lines, then press Start Level.'); updateStats(); draw();
}
function startLevel() {
  resetLevel(); running = true; levelStartTime = simTime; makeChicken(); nextArrival = simTime + exponential(arrivalRate()); ui.start.disabled = true; ui.pause.disabled = false; setStatus('The chickens are coming! Watch the line.', 'running');
}
function createServer(index) { return { chicken: null, start: 0, duration: 0, brokenUntil: 0, index }; }
function syncServers() {
  while (servers.length < serverCount()) servers.push(createServer(servers.length));
}
function makeChicken() {
  const roll = Math.random(); const type = roll < .10 ? 'rooster' : roll < .30 ? 'egg' : 'normal';
  const chicken = { type, arrival: simTime, start: null, service: 0, x: 24, y: 0, wobble: Math.random() * 6.28, state: type === 'rooster' ? 'charging' : 'queue', server: -1, chargeUntil: type === 'rooster' ? simTime + .5 : 0, deadAt: 0, deadX: 0, deadY: 0 };
  chickens.push(chicken); playSound(type === 'rooster' ? sounds.rooster : sounds.arrive); if (type !== 'rooster') { queue.push(chicken); assignServers(); }
}
function assignServers() {
  syncServers();
  while (queue.length) {
    const server = servers.find(line => line.index < serverCount() && line.chicken === null && line.brokenUntil <= simTime);
    if (!server) break;
    const chicken = queue.shift(); chicken.start = simTime; chicken.state = 'serving'; chicken.server = server.index;
    const multiplier = chicken.type === 'egg' ? (Math.random() < .5 ? 2 : 3) : 1;
    server.chicken = chicken; server.start = simTime; server.duration = exponential(feedingRate()) * multiplier; if (chicken.type === 'egg') playSound(sounds.egg);
  }
}
function markDeath(chicken) { const index = queue.indexOf(chicken); chicken.deadX = 160 - Math.max(0, index) * 18; chicken.deadY = 430 + Math.sin(Math.max(0, index) / 2) * 12; chicken.deadAt = simTime; chicken.state = 'dead'; died++; levelDied++; streak = 0; playSound(sounds.death); }
function checkWaitingChickens() {
  for (let i = queue.length - 1; i >= 0; i--) { const chicken = queue[i]; if (simTime - chicken.arrival > DEATH_WAIT) { queue.splice(i, 1); markDeath(chicken); } }
}
function finishLine(line) { if (!line || !line.chicken) return; line.chicken.state = 'leaving'; served++; levelServed++; streak++; playSound(sounds.feed); line.chicken = null; line.start = 0; line.duration = 0; assignServers(); }
function triggerEvent() {
  if (kidMode) return;
  const roll = Math.random();
  if (roll < .34) { const active = servers.filter(line => line.index < serverCount()); const line = active.length ? active[Math.floor(Math.random() * active.length)] : null; currentEvent = { type: 'breakdown', end: simTime + 5, line: line ? line.index : Math.floor(Math.random() * Math.max(1, serverCount())) }; if (line) line.brokenUntil = currentEvent.end; playSound(sounds.breakdown); }
  else if (roll < .67) { currentEvent = { type: 'rain', end: simTime + 8 }; startRainSound(); }
  else { currentEvent = { type: 'rush', end: simTime + 4 }; const burst = 5 + levelIndex * 2; for (let i = 0; i < burst; i++) makeChicken(); }
  nextEvent = simTime + 15 + Math.random() * 14;
}
function eventName() { if (!currentEvent) return 'Quiet farm day'; if (currentEvent.type === 'breakdown') return `🔧 Feeder broken on line ${currentEvent.line + 1}!`; if (currentEvent.type === 'rain') return '🌧️ Rainstorm! Feeding is slower!'; return '💨 Chicken rush!'; }
function stepSimulation(dt) {
  simTime += dt;
  while (simTime >= nextArrival) { makeChicken(); nextArrival = simTime + exponential(arrivalRate()); }
  if (!currentEvent && !kidMode && simTime >= nextEvent && Math.random() < level().events) triggerEvent();
  if (currentEvent && simTime >= currentEvent.end) { if (currentEvent.type === 'rain') stopRainSound(); currentEvent = null; }
  if (currentEvent && currentEvent.type === 'rush' && Math.random() < dt * 1.5) makeChicken();
  for (const chicken of chickens) if (chicken.state === 'charging' && simTime >= chicken.chargeUntil) { chicken.state = 'queue'; queue.unshift(chicken); assignServers(); }
  assignServers(); checkWaitingChickens();
  for (const line of servers) { const broken = line.brokenUntil > simTime; if (line.chicken && !broken && simTime - line.start >= line.duration) finishLine(line); }
  moneySpent += serverCount() * dt; score = Math.round(served * 10 - moneySpent - died * 20);
  if (moneySpent >= level().budget) endLevel(`Your $${level().budget} budget ran out. Try opening fewer lines.`);
  else if (levelDied > level().maxDeaths) endLevel(`Too many chickens got too tired. You had ${levelDied} deaths this level.`);
  else if (levelServed >= level().target) levelUp();
  else if (simTime - levelStartTime >= level().time) endLevel(`Time is up! You fed ${levelServed} of ${level().target}.`);
}
function endLevel(message) { running = false; outcome = 'failure'; ui.pause.disabled = true; ui.start.disabled = false; ui.start.textContent = 'Try Again'; setStatus(`Try Again! ${message}`, 'failure'); }
function levelUp() {
  if (levelIndex < levels.length - 1) levelIndex++; else levels[levelIndex].target += 10;
  levelServed = 0; levelDied = 0; moneySpent = 0; queue = []; chickens = []; servers = Array.from({ length: serverCount() }, (_, i) => createServer(i)); levelStartTime = simTime; nextEvent = simTime + 12; currentEvent = null; levelUpUntil = simTime + 5; outcome = 'success';
  stopRainSound(); playSound(sounds.levelUp); setStatus(`⭐ Level Up! Welcome to Level ${levelIndex + 1}! Keep feeding!`, 'success');
}
function updateStats() { ui.served.textContent = served; ui.died.textContent = died; ui.money.textContent = `$${Math.floor(moneySpent)}`; ui.score.textContent = score; ui.clock.textContent = `Farm clock: ${simTime.toFixed(1)} s`; ui.streak.textContent = `Streak: ${streak} 🔥`; ui.event.textContent = levelUpUntil > simTime ? `⭐ LEVEL UP! Level ${levelIndex + 1}` : running ? eventName() : outcome === 'failure' ? 'Farm day over' : 'Ready for chickens'; updateLevelPanel(); }
function drawChicken(chicken, x, y) {
  const bob = Math.sin(simTime * 5 + chicken.wobble) * 2;
  const body = chicken.type === 'rooster' ? '#f04d43' : chicken.type === 'egg' ? '#f6c84d' : '#fff8dc';
  const outline = chicken.type === 'rooster' ? '#a52b31' : chicken.type === 'egg' ? '#b27c1d' : '#b18b4d';
  ctx.save(); ctx.translate(x, y + bob); ctx.lineWidth = 2; ctx.strokeStyle = outline;
  // Shadow and plump body
  ctx.fillStyle = 'rgba(55, 98, 45, .18)'; ctx.beginPath(); ctx.ellipse(1, 17, 15, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, 15, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Fluffy wing
  ctx.fillStyle = chicken.type === 'rooster' ? '#d9363d' : chicken.type === 'egg' ? '#e4ad35' : '#f3e9bd'; ctx.beginPath(); ctx.ellipse(-6, 3, 7, 5, -.35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Feet
  ctx.strokeStyle = '#d47b3d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-5, 10); ctx.lineTo(-6, 17); ctx.moveTo(5, 10); ctx.lineTo(6, 17); ctx.moveTo(-10, 17); ctx.lineTo(-3, 17); ctx.moveTo(3, 17); ctx.lineTo(10, 17); ctx.stroke();
  // Face, beak, and cheek
  ctx.fillStyle = '#fff1a7'; ctx.beginPath(); ctx.arc(7, 4, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#252b24'; ctx.beginPath(); ctx.arc(6, -4, 2.3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#e17c43'; ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(22, 4); ctx.lineTo(13, 8); ctx.closePath(); ctx.fill();
  if (chicken.type === 'rooster') { ctx.fillStyle = '#cf3037'; ctx.strokeStyle = '#a52b31'; ctx.beginPath(); ctx.arc(-6, -13, 5, 0, Math.PI * 2); ctx.arc(1, -15, 6, 0, Math.PI * 2); ctx.arc(8, -12, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#d9383b'; ctx.beginPath(); ctx.ellipse(14, 10, 5, 3, .4, 0, Math.PI * 2); ctx.fill(); }
  if (chicken.type === 'egg') { ctx.fillStyle = '#fff9d7'; ctx.strokeStyle = '#b9821d'; ctx.beginPath(); ctx.ellipse(-4, 21, 6, 8, -.25, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}
function drawCloud(x, y, scale) { ctx.fillStyle = '#fffdf5'; ctx.beginPath(); ctx.arc(x, y, 18 * scale, 0, Math.PI * 2); ctx.arc(x + 25 * scale, y - 8 * scale, 24 * scale, 0, Math.PI * 2); ctx.arc(x + 54 * scale, y, 18 * scale, 0, Math.PI * 2); ctx.fill(); }
function drawDecorations() {
  const butterflyX = 455 + Math.sin(simTime * 1.8) * 70, butterflyY = 325 + Math.cos(simTime * 2.2) * 16;
  ctx.fillStyle = '#f08bb4'; ctx.beginPath(); ctx.arc(butterflyX - 6, butterflyY, 6, 0, Math.PI * 2); ctx.arc(butterflyX + 6, butterflyY, 6, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#4f6947'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(butterflyX, butterflyY); ctx.lineTo(butterflyX, butterflyY + 10); ctx.stroke();
  for (let i = 0; i < 14; i++) { const x = 170 + i * 57, y = 315 + (i % 3) * 14; ctx.fillStyle = i % 2 ? '#f7b74d' : '#e9789d'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#f8da55'; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
  if (levelUpUntil > simTime) { for (let i = 0; i < 18; i++) { const x = 300 + ((i * 53) % 360), y = 82 + ((i * 29) % 85); ctx.fillStyle = ['#ef4c42', '#ffd44d', '#76cbed', '#8fd06f'][i % 4]; ctx.save(); ctx.translate(x, y); ctx.rotate(simTime * 2 + i); ctx.fillRect(-4, -4, 8, 8); ctx.restore(); } }
}
function draw() {
  const w = canvas.width, h = canvas.height; ctx.clearRect(0, 0, w, h); const sky = ctx.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#68c7ee'); sky.addColorStop(1, '#bcebf8'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffe176'; ctx.beginPath(); ctx.arc(75, 65, 35, 0, Math.PI * 2); ctx.fill(); drawCloud(200 + (simTime * 4 % 100), 56, .8); drawCloud(650 - (simTime * 2 % 80), 45, .65);
  ctx.fillStyle = '#a8dc7b'; ctx.fillRect(0, 290, w, h - 290); ctx.fillStyle = '#8fc76a'; ctx.fillRect(0, 395, w, h - 395);
  ctx.fillStyle = '#f7d99d'; ctx.fillRect(14, 220, 120, 110); ctx.fillStyle = '#e35b4b'; ctx.beginPath(); ctx.moveTo(0, 220); ctx.lineTo(74, 164); ctx.lineTo(148, 220); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#8d5b42'; ctx.fillRect(58, 263, 34, 67); ctx.fillStyle = '#aedfec'; ctx.fillRect(27, 246, 25, 25); ctx.fillRect(99, 246, 25, 25); ctx.fillStyle = '#fff5ce'; ctx.font = 'bold 17px Trebuchet MS'; ctx.fillText('FARM', 43, 211);
  ctx.strokeStyle = '#fff4cf'; ctx.lineWidth = 5; for (let x = 155; x < w; x += 42) { ctx.beginPath(); ctx.moveTo(x, 355); ctx.lineTo(x, 393); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(145, 372); ctx.lineTo(w, 372); ctx.stroke(); drawDecorations();
  ctx.fillStyle = '#f1cf85'; ctx.fillRect(185, 95, 690, 190); const count = serverCount(); for (let i = 0; i < count; i++) { const x = 205 + i * 112; ctx.fillStyle = '#f5e0a6'; ctx.fillRect(x, 105, 92, 160); ctx.strokeStyle = '#c59651'; ctx.lineWidth = 3; ctx.strokeRect(x, 105, 92, 160); ctx.fillStyle = '#38714d'; ctx.font = 'bold 12px Trebuchet MS'; ctx.fillText(`LINE ${i + 1}`, x + 24, 124); ctx.fillStyle = '#c39b54'; ctx.fillRect(x + 15, 150, 62, 8); ctx.fillRect(x + 15, 234, 62, 8); if (currentEvent && currentEvent.type === 'breakdown' && currentEvent.line === i) { ctx.fillStyle = '#e54f45'; ctx.font = 'bold 25px sans-serif'; ctx.fillText('🔧', x + 33, 205); } }
  for (const chicken of chickens) {
    if (chicken.state === 'dead') { const age = simTime - chicken.deadAt; if (age < 1) { ctx.save(); ctx.globalAlpha = 1 - age; ctx.font = '22px sans-serif'; ctx.fillText('💀', chicken.deadX, chicken.deadY); ctx.restore(); } continue; }
    if (chicken.state === 'leaving') continue;
    let x, y;
    if (chicken.state === 'queue') { const index = queue.indexOf(chicken); x = 160 - index * 18; y = 430 + Math.sin(index / 2) * 12; }
    else if (chicken.state === 'charging') { const progress = Math.min(1, (simTime - chicken.arrival) / .5); x = 35 + progress * 100; y = 430 + Math.sin(progress * Math.PI) * -22; }
    else { x = 220 + chicken.server * 112 + 46; y = 190; }
    drawChicken(chicken, x, y);
  }
  ctx.fillStyle = '#205638'; ctx.font = 'bold 16px Trebuchet MS'; ctx.fillText(`Waiting: ${queue.length}`, 20, 470); ctx.fillText(`Busy lines: ${servers.filter(line => line.chicken !== null).length}/${count}`, 20, 498); ctx.fillStyle = '#fff8da'; ctx.font = '13px Trebuchet MS'; ctx.fillText('Red = rooster   Gold = egg-layer', 20, 526);
}
function frame(timestamp) { if (!lastFrame) lastFrame = timestamp; const realDt = Math.min(.1, (timestamp - lastFrame) / 1000); lastFrame = timestamp; if (running && !paused) { accumulator += realDt * 1.8; while (accumulator >= .1 && running) { stepSimulation(.1); accumulator -= .1; } } updateStats(); draw(); requestAnimationFrame(frame); }

ui.servers.addEventListener('input', () => { refreshControls(); if (!running) { updateStats(); draw(); } });
ui.start.addEventListener('click', () => { startLevel(); });
ui.pause.addEventListener('click', () => { paused = !paused; ui.pause.textContent = paused ? 'Resume' : 'Pause'; setStatus(paused ? 'Game paused.' : 'The chickens are moving again!', paused ? 'neutral' : 'running'); });
ui.reset.addEventListener('click', () => { levelIndex = 0; resetLevel(); });
let touchStartX = 0, touchStartY = 0;
canvas.addEventListener('pointerdown', event => { touchStartX = event.clientX; touchStartY = event.clientY; canvas.setPointerCapture?.(event.pointerId); });
canvas.addEventListener('pointerup', event => {
  const dx = event.clientX - touchStartX, dy = event.clientY - touchStartY;
  if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy)) {
    const nextCount = Math.max(1, Math.min(6, serverCount() + (dx > 0 ? 1 : -1))); ui.servers.value = nextCount; refreshControls(); updateStats(); draw();
  } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && running) {
    paused = !paused; ui.pause.textContent = paused ? 'Resume' : 'Pause'; setStatus(paused ? 'Game paused.' : 'The chickens are moving again!', paused ? 'neutral' : 'running');
  }
});
refreshControls(); resetLevel(); requestAnimationFrame(frame);
