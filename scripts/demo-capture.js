// Inserted only by record-demo.mjs. Real game frames and telemetry, with editorial
// captions. Scripted throttle/brake inputs are explicitly labelled in the video.
const demoCanvas = document.createElement('canvas');
demoCanvas.width = 1280; demoCanvas.height = 720;
const demoCtx = demoCanvas.getContext('2d');
const demoMascot = new Image(); demoMascot.src = '/assets/aunty-pit-wall-sprites.png';
const demoButton = document.createElement('button');
demoButton.textContent = 'Record 90-second demo';
demoButton.style.cssText = 'position:fixed;z-index:99999;left:40%;top:45%;padding:22px;font:bold 22px system-ui;background:#f7485b;color:white;border:0;border-radius:12px';
document.body.appendChild(demoButton);
let demoRecorder, demoStart = 0, demoTake = -1, demoFinished = false;
const demoChapters = [
  ['AUNTY F1 BY THE BAY', 'A Singapore racing game with a very opinionated pit crew.', 'MARINA BAY / SINGAPORE'],
  ['LIGHTS OUT. LET’S GO.', 'Rear chase camera • acceleration & boost • live lap timing', '01 / THE RACE'],
  ['MEET AUNTY MEI', 'A reactive companion, with expressions and a live text bubble.', '02 / YOUR PIT CREW'],
  ['MORE THAN A RACE', 'Driving reactions and local stories, triggered by location and telemetry.', '03 / SINGAPORE STORIES'],
  ['BUILT WITH ASTRA IN CODEX', 'Human feedback → inspect code → implement → browser-check → iterate', '04 / AGENTIC ENGINEERING'],
  ['REAL ENGINEERING, TESTED', 'Three.js rendering + Rapier physics • 7 automated checks passed', '05 / THE BUILD'],
  ['A COLLABORATIVE BUILD', 'Existing prototype and credited 3D track, refined with Astra and playtesting.', '06 / THE PROCESS'],
  ['PLAY IN YOUR BROWSER', 'Public Sites deployment • source on github.com/Ram349/AstraHack', '07 / SHARE & PLAY'],
  ['YOUR LAP. HER OPINIONS.', 'marina-bay-racer.ram-d-pradhan.chatgpt.site', 'AUNTY F1 BY THE BAY / RAM DILIP PRADHAN'],
];
demoButton.addEventListener('click', () => {
  if (!physicsReady) { demoButton.textContent = 'Track loading — click again shortly'; return; }
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  demoRecorder = new MediaRecorder(demoCanvas.captureStream(30), { mimeType, videoBitsPerSecond: 2400000 });
  const chunks = [];
  demoRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  demoRecorder.onstop = async () => {
    demoButton.hidden = false; demoButton.textContent = 'Saving recording…';
    try {
      const result = await fetch('/capture', { method: 'POST', headers: { 'Content-Type': mimeType }, body: new Blob(chunks, { type: mimeType }) });
      demoButton.textContent = result.ok ? '90-second recording saved' : 'Recording save failed';
    } catch { demoButton.textContent = 'Recording save failed'; }
  };
  demoStart = performance.now(); demoButton.hidden = true;
  demoRecorder.start(1000);
});
function demoBeforeFrame() {
  if (!demoStart || demoFinished) return;
  const elapsed = (performance.now() - demoStart) / 1000;
  const take = Math.floor(elapsed / 30);
  if (take !== demoTake) {
    demoTake = take; resetRace(); setRacePhase('flyover');
  }
  keys.clear();
  if (['go', 'racing'].includes(presentation.phase)) {
    const drivingTime = elapsed % 30 - 11.8;
    if (drivingTime < 4.2) keys.add('w');
    if (drivingTime > 2.7 && drivingTime < 3.8) keys.add('shift');
    if (drivingTime >= 4.2 && drivingTime < 9) keys.add(' ');
    // Brief, balanced steering corrections, then return to the straight.
    if (drivingTime > 1.5 && drivingTime < 1.65) keys.add('a');
    if (drivingTime > 2.0 && drivingTime < 2.15) keys.add('d');
  }
}
function demoPanel(x, y, w, h, color = 'rgba(6,16,28,.90)') {
  demoCtx.fillStyle = color; demoCtx.beginPath(); demoCtx.roundRect(x,y,w,h,12); demoCtx.fill();
}
function demoText(text, x, y, size = 22, color = '#fff', weight = 600) {
  demoCtx.font = `${weight} ${size}px Arial, sans-serif`; demoCtx.fillStyle = color; demoCtx.fillText(text, x, y);
}
function demoWrap(text, x, y, width, size = 20) {
  demoCtx.font = `600 ${size}px Arial, sans-serif`;
  let line = ''; let row = 0;
  for (const word of text.split(' ')) {
    if (demoCtx.measureText(line + word).width > width && line) { demoText(line, x, y + row++ * (size + 7), size); line = ''; }
    line += word + ' ';
  }
  demoText(line, x, y + row * (size + 7), size);
}
function demoAfterFrame() {
  if (!demoStart || demoFinished) return;
  const elapsed = (performance.now() - demoStart) / 1000;
  demoCtx.drawImage(renderer.domElement, 0, 0, 1280, 720);
  const chapter = demoChapters[Math.min(8, Math.floor(elapsed / 10))];
  demoPanel(20, 18, 1240, 118);
  demoText(chapter[2], 40, 43, 13, '#72d9ff');
  demoText(chapter[0], 40, 78, 30);
  demoText(chapter[1], 40, 113, 20, '#d9e4ef', 400);
  demoPanel(20, 151, 282, 84);
  demoText(document.querySelector('#location-name').textContent, 34, 180, 19, '#9edfff');
  demoText(lapTimeEl.textContent, 34, 218, 32);
  const phase = presentation.phase;
  if (phase === 'countdown' || phase === 'go') {
    demoPanel(546, 250, 188, 151, 'rgba(5,16,29,.72)');
    demoCtx.textAlign = 'center';
    demoText(countdownNumberEl.textContent, 640, 355, 90, phase === 'go' ? '#83ffd5' : '#fff');
    demoCtx.textAlign = 'left';
  }
  demoPanel(20, 564, 244, 117);
  demoText(speedEl.textContent + ' KM/H', 37, 608, 34);
  demoText('GEAR ' + gearEl.textContent + '  ·  ' + (drive.boosting ? 'BOOST' : 'RAPIER'), 37, 640, 16, '#77dcff');
  demoText('W accelerate / A D steer', 37, 665, 15, '#c1cedd', 400);
  demoPanel(644, 541, 616, 140);
  demoText(auntyStatusEl.textContent, 666, 568, 13, '#75d9ff');
  demoWrap(commentaryLineEl.textContent, 666, 598, 435, 19);
  if (demoMascot.complete && demoMascot.naturalWidth) {
    const expression = auntyPetEl.dataset.expression;
    const col = ['talking', 'concerned'].includes(expression) ? 1 : 0;
    const row = ['cheering', 'concerned'].includes(expression) ? 1 : 0;
    const sw = demoMascot.naturalWidth / 2, sh = demoMascot.naturalHeight / 2;
    demoCtx.drawImage(demoMascot, col * sw, row * sh, sw, sh, 1108, 523, 146, 150);
  }
  demoCtx.fillStyle = '#07101c'; demoCtx.fillRect(0, 693, 1280, 27);
  demoText('LOCAL GAMEPLAY • SCRIPTED CONTROL INPUTS • EDITORIAL CAPTIONS • TEXT COMMENTARY SHOWN', 20, 711, 11, '#a9bccf', 400);
  demoCtx.fillStyle = '#f7485b'; demoCtx.fillRect(0, 690, 1280 * Math.min(1, elapsed / 90), 3);
  if (elapsed >= 90) {
    demoFinished = true; keys.clear(); demoRecorder.stop();
  }
}
