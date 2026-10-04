import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const temp = mkdtempSync(path.join(tmpdir(), 'overlay-input-browser-'));
let server;
async function start() {
  server = spawn(process.execPath, ['dist-server/server/index.js'], {
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', BASE_PATH: '/youtube_overlay', DATA_PATH: path.join(temp, 'db.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    server.stdout.on('data', chunk => {
      const match = String(chunk).match(/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}/youtube_overlay`); }
    });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
  });
}
async function stop() {
  if (server?.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}

const base = await start();
const accessKey = readFileSync(path.join(temp, 'director-access-key'), 'utf8').trim();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/local/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const director = await context.newPage();
const output = await context.newPage();
const phone = await context.newPage();
const errors = [];
for (const page of [director, output, phone]) page.on('pageerror', error => errors.push(error.message));
await phone.addInitScript(() => {
  window.__captureCalls = 0;
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (...args) => { window.__captureCalls += 1; return original(...args); };
});

try {
  await Promise.all([director.goto(`${base}/director#access=${encodeURIComponent(accessKey)}`), output.goto(`${base}/output`)]);
  await director.getByText('Connected', { exact: true }).waitFor();
  assert.equal(new URL(director.url()).hash.includes('access='), false);
  await director.getByLabel('YouTube stream or video').fill('aqz-KE-bpKQ');
  await director.getByRole('button', { name: 'Set video', exact: true }).click();
  await director.locator('.phone-invites summary').click();
  await director.getByRole('button', { name: 'Create phone links' }).click();
  const invite = await director.locator('#invite-phone1').inputValue();
  assert.equal(new URL(invite).pathname, '/youtube_overlay/phone');
  await phone.goto(invite);
  assert.equal(await phone.evaluate(() => window.__captureCalls), 0);
  assert.equal(await phone.locator('video').count(), 0);
  await phone.getByRole('button', { name: 'Start camera' }).click();
  await phone.getByText('Ready for director').waitFor();
  assert.equal(await phone.evaluate(() => window.__captureCalls), 1);
  await director.locator('.source-choice').filter({ hasText: 'Phone 1' }).click();
  await output.waitForFunction(() => {
    const video = document.querySelector('.camera-output video');
    return video?.videoWidth > 0 && video.srcObject?.getVideoTracks().length > 0;
  }, null, { timeout: 20000 });
  assert.equal(await director.locator('.input-preview').evaluate(video => video.muted), true);
  assert.equal(new URL(output.url()).searchParams.has('token'), false);
  assert.equal((await output.content()).includes(new URL(invite).searchParams.get('token')), false);
  console.log('Phone capture starts on click and WebRTC delivers live video to Output');

  await director.getByLabel('Follow selected source audio').click();
  await director.waitForFunction(() => !document.querySelector('.follow-audio input')?.checked);
  await director.locator('.source-choice').filter({ hasText: 'YouTube' }).click();
  await output.locator('iframe[src*="/embed/aqz-KE-bpKQ"]').waitFor();
  await output.waitForFunction(() => {
    const stream = document.querySelector('audio')?.srcObject;
    return stream?.getAudioTracks().length > 0 && stream.getVideoTracks().length === 0;
  }, null, { timeout: 20000 });
  assert.equal(await output.locator('iframe').evaluate(frame => new URL(frame.src).searchParams.get('mute')), '1');
  await director.locator('.source-choice').filter({ hasText: 'Phone 1' }).click();
  await output.waitForFunction(() => document.querySelector('.camera-output video')?.videoWidth > 0, null, { timeout: 20000 });
  console.log('Manual camera audio works with visible YouTube video and no hidden video track');

  await director.getByRole('button', { name: 'Load built-in test graphic' }).click();
  await director.waitForFunction(() => !document.querySelector('.take-button').disabled);
  await director.getByLabel('Image layout').selectOption('pip');
  await director.locator('.take-button').click();
  await output.locator('.output-shell.graphic-mode.layout-pip').waitFor();
  assert.equal(await output.locator('.camera-output video').evaluate(video => video.videoWidth > 0), true);
  console.log('Image TAKE and picture in picture retain the selected camera');

  await phone.getByRole('button', { name: 'Stop camera' }).click();
  await output.locator('iframe[src*="/embed/aqz-KE-bpKQ"]').waitFor({ timeout: 15000 });
  await director.getByText(/Output returned to the saved YouTube video/).waitFor();
  console.log('Phone disconnect falls back to saved YouTube and reports it to Director');

  await director.getByRole('button', { name: 'Start webcam' }).click();
  await director.locator('.camera-state.camera-ready').waitFor();
  await director.getByRole('button', { name: 'Director webcam', exact: true }).click();
  await output.waitForFunction(() => document.querySelector('.camera-output video')?.videoWidth > 0, null, { timeout: 20000 });
  await director.getByRole('button', { name: 'Stop webcam' }).click();
  await output.locator('iframe[src*="/embed/aqz-KE-bpKQ"]').waitFor({ timeout: 15000 });
  console.log('Director webcam also supplies Output and falls back on stop');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await stop();
  rmSync(temp, { recursive: true, force: true });
}
