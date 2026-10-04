import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const evidence = process.env.EVIDENCE_DIR ?? '.playback-evidence'; mkdirSync(evidence, { recursive: true });
const temp = mkdtempSync(path.join(tmpdir(), 'overlay-playback-'));
let server, port = '0';
async function start() {
  server = spawn(process.execPath, ['dist-server/server/index.js'], { env: { ...process.env, PORT: port, HOST: '127.0.0.1', BASE_PATH: '/youtube_overlay', DATA_PATH: path.join(temp, 'db.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000);
    server.stdout.on('data', chunk => { const match = String(chunk).match(/127.0.0.1:(\d+)/); if (match) { clearTimeout(timer); port = match[1]; resolve(`http://127.0.0.1:${port}/youtube_overlay`); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
  });
}
async function stop() { if (server?.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); }
const base = process.env.BASE_URL ?? await start();
const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
// A deterministic IFrame API validates commands and recovery without claiming real YouTube media playback.
await context.addInitScript(() => {
  window.__players = [];
  window.YT = { Player: class {
    constructor(frame, { events }) {
      this.events = events; this.time = 240; this.state = -1; this.at = Date.now(); this.frame = frame; this.seeks = [];
      window.__players.push(this); setTimeout(() => events.onReady({ target: this }), 30);
    }
    getCurrentTime() { return Math.min(7200, this.time + (this.state === 1 ? (Date.now() - this.at) / 1000 : 0)); }
    getDuration() { return 7200; } getPlayerState() { return this.state; }
    playVideo() { this.time = this.getCurrentTime(); this.at = Date.now(); this.state = 1; this.events.onStateChange({ data: 1, target: this }); }
    pauseVideo() { this.time = this.getCurrentTime(); this.at = Date.now(); this.state = 2; this.events.onStateChange({ data: 2, target: this }); }
    seekTo(time) { this.time = time; this.at = Date.now(); this.seeks.push(time); }
    mute() {} unMute() {} destroy() { this.frame.remove(); }
  } };
});
const director = await context.newPage(), output = await context.newPage();
const errors = []; for (const page of [director, output]) page.on('pageerror', error => errors.push(error.message));
const observations = [];
function record(message) { observations.push(message); console.log(message); }
async function waitPosition(page, time, state = 2) {
  await page.waitForFunction(({ time, state }) => { const player = window.__players.at(-1); return player?.state === state && Math.abs(player.getCurrentTime() - time) < (state === 1 ? 5 : 1); }, { time, state });
}
try {
  await Promise.all([director.goto(`${base}/director`, { waitUntil: 'domcontentloaded' }), output.goto(`${base}/output`, { waitUntil: 'domcontentloaded' })]);
  await director.getByText('Connected', { exact: true }).waitFor();
  await director.getByLabel('YouTube stream or video').fill('aqz-KE-bpKQ'); await director.getByRole('button', { name: 'Set video', exact: true }).click();
  await director.waitForFunction(() => !document.querySelector('.play-pause')?.disabled);
  await director.getByText(/TV: Playing/).waitFor();
  await director.getByRole('button', { name: 'Ⅱ Pause', exact: true }).click();
  await output.waitForFunction(() => window.__players.at(-1)?.state === 2);
  const frozen = await output.evaluate(() => window.__players.at(-1).getCurrentTime());
  await output.waitForTimeout(1200);
  assert.ok(Math.abs(await output.evaluate(() => window.__players.at(-1).getCurrentTime()) - frozen) < .01);
  record('Director pause freezes both players and confirms TV feedback');
  await director.getByLabel('Seek to time', { exact: true }).fill('1:02:03'); await director.getByRole('button', { name: 'Seek', exact: true }).click();
  await waitPosition(output, 3723); await waitPosition(director, 3723);
  await director.getByRole('button', { name: 'Rewind 10 seconds', exact: true }).click(); await waitPosition(output, 3713);
  await director.getByRole('button', { name: 'Fast forward 10 seconds', exact: true }).click(); await waitPosition(output, 3723);
  record('Timestamp seeking, rewind and fast forward preserve a shared pause');
  const slider = director.getByLabel('Seek video', { exact: true }); await director.waitForFunction(() => !document.querySelector('.seek-slider').disabled); await slider.focus(); await slider.press('Home'); await waitPosition(output, 0);
  await director.waitForFunction(() => !document.querySelector('.seek-slider').disabled);
  await slider.press('ArrowRight'); await waitPosition(output, 1);
  record('Keyboard scrubbing commits exact shared seeks');
  const sliderBox = await slider.boundingBox();
  await director.mouse.move(sliderBox.x + sliderBox.width / 2, sliderBox.y + sliderBox.height / 2); await director.mouse.down(); await director.mouse.move(sliderBox.x + sliderBox.width * .25, sliderBox.y + sliderBox.height / 2); await director.mouse.up();
  await output.waitForFunction(() => { const p = window.__players.at(-1); return p.state === 2 && p.time > 1700 && p.time < 1900; });
  record('Pointer scrubbing commits on release and preserves pause');
  await director.getByLabel('Seek to time', { exact: true }).fill('0:00'); await director.getByRole('button', { name: 'Seek', exact: true }).click(); await waitPosition(output, 0);
  await director.getByRole('button', { name: 'Rewind 10 seconds', exact: true }).click(); await waitPosition(output, 0);
  await director.getByLabel('Seek to time', { exact: true }).fill('1:60'); await director.getByRole('button', { name: 'Seek', exact: true }).click(); await director.getByRole('alert').getByText('Enter seconds, mm:ss, or hh:mm:ss.').waitFor();
  await director.getByLabel('Seek to time', { exact: true }).fill('3:00:00'); await director.getByRole('button', { name: 'Seek', exact: true }).click(); await director.getByText('That time is beyond the available video.').waitFor();
  record('Rewind clamps at zero; invalid and out of range timestamps have visible errors');
  await director.getByLabel('Seek to time', { exact: true }).fill('5:00'); await director.getByRole('button', { name: 'Seek', exact: true }).click(); await waitPosition(output, 300);
  await director.getByRole('button', { name: 'Load built-in test graphic', exact: true }).click(); await director.waitForFunction(() => !document.querySelector('.take-button').disabled); await director.locator('.take-button').click();
  await output.locator('.output-shell.graphic-mode').waitFor(); await waitPosition(output, 300);
  assert.equal(await output.evaluate(() => window.__players.length), 1);
  await director.locator('.live-button').click(); await output.locator('.output-shell.live-mode').waitFor(); await waitPosition(output, 300);
  record('TAKE/LIVE preserve pause and player identity');
  await Promise.all([director.reload({ waitUntil: 'domcontentloaded' }), output.reload({ waitUntil: 'domcontentloaded' })]); await waitPosition(output, 300); await waitPosition(director, 300);
  if (!process.env.BASE_URL) { await stop(); await start(); await director.getByText('Connected', { exact: true }).waitFor(); await Promise.all([director.reload({ waitUntil: 'domcontentloaded' }), output.reload({ waitUntil: 'domcontentloaded' })]); await waitPosition(output, 300); }
  record('Paused position restores after both browser reloads and an isolated real server restart');
  await director.getByRole('button', { name: '▶ Play', exact: true }).click(); await waitPosition(output, 300, 1);
  await output.waitForTimeout(2500); await output.evaluate(() => window.__players.at(-1).pauseVideo());
  await director.getByRole('button', { name: '▶ Play', exact: true }).waitFor();
  await output.waitForTimeout(2500); await output.evaluate(() => window.__players.at(-1).seekTo(600)); await waitPosition(director, 600);
  record('Native YouTube pause and seek also update shared playback');
  await director.setViewportSize({ width: 390, height: 844 }); await director.screenshot({ path: path.join(evidence, 'director-mobile.png'), fullPage: true });
  assert.equal(await director.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await director.setViewportSize({ width: 1440, height: 1000 }); await director.screenshot({ path: path.join(evidence, 'director.png'), fullPage: true });
  await output.screenshot({ path: path.join(evidence, 'output.png'), fullPage: true });
  assert.deepEqual(errors, []); record('Desktop and mobile controls render without overflow or uncaught browser errors');
  writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ passed: true, simulatedMedia: true, observations }, null, 2));
} catch (error) {
  console.error('Playback failure evidence', await director.evaluate(() => ({ players: window.__players.map(p => ({ time: p.getCurrentTime(), state: p.state, seeks: p.seeks })), slider: document.querySelector('.seek-slider')?.value, disabled: document.querySelector('.seek-slider')?.disabled, alerts: [...document.querySelectorAll('[role="alert"]')].map(el => el.textContent) })), await output.evaluate(() => window.__players.map(p => ({ time: p.getCurrentTime(), state: p.state, seeks: p.seeks }))));
  await director.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); await stop(); rmSync(temp, { recursive: true, force: true }); }
