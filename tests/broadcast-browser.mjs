import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
const evidence = process.env.EVIDENCE_DIR ?? '.broadcast-evidence'; mkdirSync(evidence, { recursive: true });
const temp = mkdtempSync(path.join(tmpdir(), 'overlay-broadcast-'));
let server;
const base = await new Promise((resolve, reject) => {
  server = spawn(process.execPath, ['dist-server/server/index.js'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', BASE_PATH: '/youtube_overlay', DATA_PATH: path.join(temp, 'db.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000);
  server.stdout.on('data', chunk => { const match = String(chunk).match(/127.0.0.1:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}/youtube_overlay`); } });
  server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
});
const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await context.addInitScript(() => {
  window.__players = [];
  window.YT = { Player: class {
    constructor(frame, { events }) { this.events = events; this.time = 240; this.state = -1; this.at = Date.now(); this.frame = frame; this.muted = false; this.destroyed = false; window.__players.push(this); setTimeout(() => events.onReady({ target: this }), 30); }
    getCurrentTime() { return this.time + (this.state === 1 ? (Date.now() - this.at) / 1000 : 0); }
    getDuration() { return 7200; } getPlayerState() { return this.state; }
    playVideo() { this.time = this.getCurrentTime(); this.at = Date.now(); this.state = 1; this.events.onStateChange({ data: 1, target: this }); }
    pauseVideo() { this.time = this.getCurrentTime(); this.at = Date.now(); this.state = 2; this.events.onStateChange({ data: 2, target: this }); }
    seekTo(time) { this.time = time; this.at = Date.now(); }
    mute() { this.muted = true; } unMute() { this.muted = false; } destroy() { this.destroyed = true; this.frame.remove(); }
  } };
});
await context.route('https://www.youtube.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 40% 30%,#637b91,#163345 60%,#061921);color:white;font:600 30px system-ui"><div style="text-align:center"><div style="font-size:80px">◉</div>VIDEO FEED<div style="font-size:16px;font-weight:400;margin-top:10px;opacity:.6">Simulated broadcast playback</div></div></body></html>' }));
const director = await context.newPage(), output = await context.newPage();
const errors = []; for (const page of [director, output]) page.on('pageerror', error => errors.push(error.message));
const observations = [];
let searchServer;
function record(message) { observations.push(message); console.log(message); }
async function isOnscreen(locator) {
  const box = await locator.boundingBox(); assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1367 && box.y + box.height <= 769, JSON.stringify(box));
}
async function assertPlaying() {
  assert.equal(await output.evaluate(() => window.__players.length), 1);
  assert.equal(await output.evaluate(() => window.__players[0].destroyed), false);
  assert.equal(await output.evaluate(() => window.__players[0].muted), false);
  assert.equal(await output.evaluate(() => window.__players[0].getPlayerState()), 1);
  assert.equal(await output.locator('iframe').getAttribute('data-player-identity'), 'original');
}
try {
  await Promise.all([director.goto(`${base}/director`, { waitUntil: 'domcontentloaded' }), output.goto(`${base}/output`, { waitUntil: 'domcontentloaded' })]);
  await director.getByText('Connected', { exact: true }).waitFor();
  await director.getByLabel('YouTube stream or video').fill('aqz-KE-bpKQ'); await director.getByRole('button', { name: 'Set video', exact: true }).click();
  await output.waitForFunction(() => window.__players[0]?.state === 1);
  await output.locator('iframe').evaluate(frame => frame.dataset.playerIdentity = 'original');
  await director.getByRole('button', { name: 'Load built-in test graphic', exact: true }).click(); await director.waitForFunction(() => !document.querySelector('.take-button').disabled);
  for (const size of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
    await director.setViewportSize(size);
    assert.equal(await director.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true);
    assert.equal(await director.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const positions = await director.locator('.take-button,.live-button,#image-query,.seek-slider').evaluateAll(elements => elements.map(el => { const box = el.getBoundingClientRect(); return { y: box.y, bottom: box.bottom, x: box.x, right: box.right }; }));
    assert.ok(positions.every(box => box.y >= 0 && box.bottom <= size.height && box.x >= 0 && box.right <= size.width));
    await director.screenshot({ path: path.join(evidence, `director-${size.width}.png`), fullPage: true });
  }
  record('Primary Director controls fit at 1366×768 and 1440×900 without document scrolling');
  await director.setViewportSize({ width: 1366, height: 768 });
  // Accessible selector names are supplied by the composition UI; data settings are verified on Output.
  const layout = director.getByLabel('Image layout', { exact: true });
  const corner = director.getByLabel('Corner', { exact: true });
  const transition = director.getByLabel('Transition', { exact: true });
  for (const name of ['shoulder', 'pip', 'image']) {
    await layout.selectOption(name); await transition.selectOption('fade');
    if (name === 'shoulder') {
      await director.getByRole('button', { name: 'Ⅱ Pause', exact: true }).click();
      await director.getByRole('button', { name: '▶ Play', exact: true }).waitFor();
      assert.equal(await layout.inputValue(), 'shoulder');
      await director.getByRole('button', { name: '▶ Play', exact: true }).click();
      await director.getByRole('button', { name: 'Ⅱ Pause', exact: true }).waitFor();
      assert.equal(await layout.inputValue(), 'shoulder');
    }
    await director.locator('.take-button').click();
    await output.waitForFunction(name => document.querySelector('.output-shell')?.dataset.layout === name, name);
    await output.waitForTimeout(450); await assertPlaying();
    assert.equal(await output.locator('.transport-controls:visible').count(), 0);
    assert.equal(await output.locator('.player-controls:visible').count(), 0);
    await output.screenshot({ path: path.join(evidence, `output-${name}.png`), fullPage: true });
  }
  record('Shoulder, corner PIP and image-only modes preserve one playing unmuted video player; no audience transport panels');
  await output.evaluate(() => window.__players[0].events.onAutoplayBlocked({ target: window.__players[0] }));
  await output.getByRole('button', { name: 'Start video', exact: true }).waitFor();
  const recoveryIsTop = await output.getByRole('button', { name: 'Start video', exact: true }).evaluate(button => {
    const box = button.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === button;
  }); assert.equal(recoveryIsTop, true);
  await output.getByRole('button', { name: 'Start video', exact: true }).click();
  await output.locator('.audience-recovery').waitFor({ state: 'hidden' }); await assertPlaying();
  await output.mouse.move(100, 100); await output.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await output.waitForFunction(() => document.fullscreenElement?.matches('[data-broadcast-output]'));
  assert.equal(await output.evaluate(() => !!document.fullscreenElement?.querySelector('.program-graphic.is-active')), true);
  await output.evaluate(() => document.exitFullscreen());
  await output.waitForTimeout(500);
  record('Image-only mode exposes autoplay recovery above the graphic; fullscreen includes the entire composition');
  await layout.selectOption('pip');
  for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    await corner.selectOption(position); await director.locator('.take-button').click();
    await output.waitForFunction(position => document.querySelector('.output-shell')?.dataset.corner === position, position);
    await output.waitForTimeout(450);
    const box = await output.locator('iframe').boundingBox();
    assert.ok(box.width < 1366 / 2 && box.height < 768 / 2);
    assert.equal(box.x < 1366 / 2, position.endsWith('left'));
    assert.equal(box.y < 768 / 2, position.startsWith('top'));
    await assertPlaying();
  }
  record('All four PIP positions are visible and match the chosen corner');
  await director.locator('.live-button').click(); await output.locator('.output-shell.live-mode').waitFor(); await output.waitForTimeout(450); await assertPlaying();
  const full = await output.locator('iframe').boundingBox(); assert.ok(full.width >= 1365 && full.height >= 767);
  record('Back to video removes the taken graphic and restores full video without restarting playback');
  const mockAsset = id => ({ id: `mock:${id}`, title: `Image ${id}`, fullUrl: `${base}/test-graphic.svg?image=${id}`, thumbnailUrl: `${base}/test-graphic.svg?image=${id}`, source: 'Acceptance fixture' });
  let releaseSlowProvider = () => {};
  searchServer = http.createServer((req, res) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const query = params.get('q');
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Access-Control-Allow-Origin': '*', 'X-Accel-Buffering': 'no' });
    const send = event => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
    const finish = cursor => { send({ type: 'done', cursor, hasMore: !!cursor, providers: [{ provider: 'commons', status: 'ok', nextCursor: cursor }, { provider: 'openverse', status: 'ok', nextCursor: null }] }); if (!res.destroyed) res.end(); };
    send({ type: 'start', query, providers: ['commons', 'openverse'] });
    if (query === 'streaming' && !params.get('cursor')) {
      send({ type: 'provider', provider: 'commons', assets: Array.from({ length: 12 }, (_, i) => mockAsset(i + 1)), nextCursor: 'second' });
      releaseSlowProvider = () => { send({ type: 'provider', provider: 'openverse', assets: [mockAsset(13)], nextCursor: null }); finish('second'); };
    } else if (query === 'streaming') {
      send({ type: 'provider', provider: 'commons', assets: [mockAsset(1), mockAsset(14)], nextCursor: null }); finish(null);
    } else if (query === 'old search') {
      send({ type: 'provider', provider: 'commons', assets: [mockAsset('old')], nextCursor: null });
      releaseSlowProvider = () => { send({ type: 'provider', provider: 'openverse', assets: [mockAsset('stale')], nextCursor: null }); finish(null); };
    } else {
      send({ type: 'provider', provider: 'commons', assets: [mockAsset('new')], nextCursor: null });
      send({ type: 'provider', provider: 'openverse', assets: [], nextCursor: null, error: 'Acceptance fixture: source unavailable' });
      send({ type: 'done', cursor: null, hasMore: false, providers: [{ provider: 'commons', status: 'ok', nextCursor: null }, { provider: 'openverse', status: 'error', nextCursor: null }] }); res.end();
    }
  });
  await new Promise(resolve => searchServer.listen(0, '127.0.0.1', resolve));
  const searchOrigin = `http://127.0.0.1:${searchServer.address().port}`;
  await director.route('**/api/images/search/stream?*', route => route.continue({ url: `${searchOrigin}/search?${new URL(route.request().url()).searchParams}` }));
  await director.locator('#image-query').fill('streaming'); await director.getByRole('button', { name: 'Search', exact: true }).click();
  await director.waitForFunction(() => document.querySelectorAll('.asset-grid .asset-card').length === 12);
  assert.equal(await director.getByRole('button', { name: 'Cancel', exact: true }).isVisible(), true);
  assert.equal(await director.getByRole('button', { name: 'Preview Image 13', exact: true }).count(), 0);
  releaseSlowProvider();
  await director.getByRole('button', { name: 'Preview Image 13', exact: true }).waitFor();
  await director.getByRole('button', { name: 'Load more images', exact: true }).click();
  await director.getByRole('button', { name: 'Preview Image 14', exact: true }).waitFor();
  assert.equal(await director.locator('.asset-grid .asset-card').count(), 14);
  assert.equal(await director.locator('.asset-grid').evaluate(el => el.scrollHeight > el.clientHeight), true);
  assert.equal(await director.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true);
  await director.screenshot({ path: path.join(evidence, 'director-search-results.png'), fullPage: true });
  record('Search renders the first provider while the second is pending; paging deduplicates and results scroll internally');
  await director.locator('#image-query').fill('old search'); await director.getByRole('button', { name: 'Search', exact: true }).click();
  await director.getByRole('button', { name: 'Preview Image old', exact: true }).waitFor();
  const finishOld = releaseSlowProvider;
  await director.locator('#image-query').fill('new search'); await director.getByRole('button', { name: 'Search', exact: true }).click();
  await director.getByRole('button', { name: 'Preview Image new', exact: true }).waitFor(); finishOld(); await director.waitForTimeout(100);
  assert.equal(await director.getByRole('button', { name: 'Preview Image stale', exact: true }).count(), 0);
  assert.equal(await director.getByRole('button', { name: 'Preview Image old', exact: true }).count(), 0);
  await director.getByText(/Openverse unavailable/).waitFor();
  record('Changing queries cancels stale streams and a failed source leaves the other source usable');
  await director.route('https://images.example/graphic.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#28546e"/></svg>' }));
  await director.locator('#image-url').fill('https://images.example/graphic.svg'); await director.getByRole('button', { name: 'Preview URL', exact: true }).click();
  await director.waitForFunction(() => !document.querySelector('.take-button').disabled);
  assert.match(await director.getByRole('link', { name: /Open Google Images/ }).getAttribute('href'), /q=new%20search/);
  record('Direct HTTPS image imports reach a loaded safe Preview; Google Images opens the matching query');
  await director.setViewportSize({ width: 390, height: 844 });
  assert.equal(await director.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await director.screenshot({ path: path.join(evidence, 'director-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ passed: true, simulatedMedia: true, observations, errors }, null, 2));
} catch (error) {
  console.error('Broadcast failure', String(error)); await director.screenshot({ path: path.join(evidence, 'failure-director.png'), fullPage: true }).catch(() => {}); await output.screenshot({ path: path.join(evidence, 'failure-output.png'), fullPage: true }).catch(() => {}); throw error;
} finally {
  await browser.close();
  if (searchServer) await new Promise(resolve => { searchServer.closeAllConnections(); searchServer.close(resolve); });
  if (server?.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  rmSync(temp, { recursive: true, force: true });
}
