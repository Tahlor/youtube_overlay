import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const temp = mkdtempSync(path.join(tmpdir(), 'overlay-input-browser-'));
let server;
const port = await reservePort();
const base = `http://127.0.0.1:${port}/youtube_overlay`;

async function reservePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local test port.');
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function start() {
  server = spawn(process.execPath, ['dist-server/server/index.js'], {
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), BASE_PATH: '/youtube_overlay', DATA_PATH: path.join(temp, 'db.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = '';
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(base);
    };
    const timer = setTimeout(() => finish(new Error(`Server startup timed out. ${stderr}`)), 10000);
    server.stderr.on('data', chunk => { stderr += String(chunk); });
    server.stdout.on('data', chunk => {
      if (String(chunk).includes(`127.0.0.1:${port}`)) finish();
    });
    server.once('exit', code => finish(new Error(`Server exited ${code}. ${stderr}`)));
  });
}

async function stop() {
  const child = server;
  if (child?.exitCode === null) {
    await new Promise(resolve => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
    });
  }
  if (server === child) server = undefined;
}

const captureCounter = () => {
  window.__captureCalls = 0;
  window.__denyCapture = false;
  const install = () => {
    const devices = navigator.mediaDevices;
    if (!devices || typeof devices.getUserMedia !== 'function') return;
    if (devices.getUserMedia.__overlayCaptureCounter) return;
    const original = devices.getUserMedia.bind(devices);
    const wrapped = (...args) => {
      window.__captureCalls += 1;
      if (window.__denyCapture) return Promise.reject(new DOMException('Permission denied for browser regression.', 'NotAllowedError'));
      return original(...args);
    };
    wrapped.__overlayCaptureCounter = true;
    devices.getUserMedia = wrapped;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
};

const fakeYouTube = () => {
  window.__ytPlayers = [];
  window.YT = { Player: class {
    constructor(frame, { events }) {
      this.frame = frame;
      this.events = events;
      this.time = 240;
      this.state = -1;
      this.at = Date.now();
      this.muted = false;
      this.volume = 100;
      window.__ytPlayers.push(this);
      setTimeout(() => events.onReady({ target: this }), 30);
    }
    getCurrentTime() { return this.state === 1 ? this.time + (Date.now() - this.at) / 1000 : this.time; }
    getDuration() { return 7200; }
    getPlayerState() { return this.state; }
    playVideo() { this.time = this.getCurrentTime(); this.at = Date.now(); this.state = 1; this.events.onStateChange({ data: 1, target: this }); }
    pauseVideo() { this.time = this.getCurrentTime(); this.at = Date.now(); this.state = 2; this.events.onStateChange({ data: 2, target: this }); }
    seekTo(time) { this.time = time; this.at = Date.now(); }
    mute() { this.muted = true; }
    unMute() { this.muted = false; }
    setVolume(value) { this.volume = value; }
    destroy() { this.frame.remove(); }
  } };
};

const PHONE_SOURCES = ['phone1', 'phone2', 'phone3', 'phone4'];
const PHONE_LABELS = { phone1: 'Phone 1', phone2: 'Phone 2', phone3: 'Phone 3', phone4: 'Phone 4' };
const VIDEO_ID = 'aqz-KE-bpKQ';

const startupBase = await start();
assert.equal(startupBase, base);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/local/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.setExtraHTTPHeaders({ 'X-Auth-Request-User': 'multi-input-test@example.test' });
await context.addInitScript(captureCounter);
await context.addInitScript(fakeYouTube);
const director = await context.newPage();
const director2 = await context.newPage();
const output = await context.newPage();
await output.addInitScript(() => {
  window.__webrtcPeers = [];
  window.__blockCameraAutoplay = false;
  const NativePeerConnection = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeerConnection {
    constructor(...args) {
      super(...args);
      window.__webrtcPeers.push(this);
    }
  };

  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (this instanceof HTMLVideoElement && this.closest('.camera-output') && window.__blockCameraAutoplay) {
      window.__blockCameraAutoplay = false;
      return Promise.reject(new DOMException('Autoplay blocked for this regression.', 'NotAllowedError'));
    }
    return nativePlay.apply(this, args);
  };

  window.__forceLatestVideoPeerFailed = () => {
    const peer = [...window.__webrtcPeers].reverse().find(connection =>
      connection.connectionState === 'connected' &&
      connection.getTransceivers().some(transceiver => transceiver.receiver.track?.kind === 'video'));
    if (!peer) throw new Error('No connected native video peer was available to fail.');
    Object.defineProperty(peer, 'connectionState', { configurable: true, get: () => 'failed' });
    peer.dispatchEvent(new Event('connectionstatechange'));
  };
});
const errors = [];
const expectedNativeNetworkErrors = [];
function recordPageError(page, error) {
  const event = { at: Date.now(), url: page.url(), name: error.name, message: error.message, stack: error.stack || '' };
  // Chromium reports ICE negotiation/teardown failures as stackless native NetworkError
  // events under fake capture. App-level errors still fail the test; visible fallback,
  // retry, and session restart behavior are asserted separately below.
  if (event.name === 'NetworkError' && event.message === 'A network error occurred.' && !event.stack) {
    expectedNativeNetworkErrors.push(event);
    return;
  }
  errors.push(event);
}
const allPages = [director, director2, output];
for (const page of allPages) page.on('pageerror', error => recordPageError(page, error));
const phones = [];
for (const source of PHONE_SOURCES) {
  const page = await context.newPage();
  page.on('pageerror', error => recordPageError(page, error));
  phones.push(page);
}

try {
  await director.addInitScript(() => localStorage.setItem('overlay-director-access', 'retired-test-key'));
  await Promise.all([
    director.goto(`${base}/director#access=retired-test-key`, { waitUntil: 'domcontentloaded' }),
    output.goto(`${base}/output`, { waitUntil: 'domcontentloaded' }),
  ]);
  await director.getByText('Connected', { exact: true }).waitFor();
  await director.getByText('SSO · multi-input-test@example.test').waitFor();
  assert.equal(new URL(director.url()).hash.includes('access='), false, 'Legacy Director credentials should be removed from old links.');
  assert.equal(await director.evaluate(() => localStorage.getItem('overlay-director-access')), null, 'Legacy Director credentials should be removed from browser storage.');
  assert.equal(await director.evaluate(() => window.__captureCalls), 0, 'Director camera must stay off before Start webcam.');

  await director.getByLabel('YouTube stream or video').fill(VIDEO_ID);
  await director.getByRole('button', { name: 'Set video', exact: true }).click();
  await Promise.all([
    director.locator(`iframe[src*="/embed/${VIDEO_ID}"]`).waitFor(),
    output.locator(`iframe[src*="/embed/${VIDEO_ID}"]`).waitFor(),
  ]);
  await director.waitForFunction(() => !document.querySelector('.seek-form input')?.disabled);
  await director.getByLabel('Seek to time', { exact: true }).fill('2:03');
  await director.getByRole('button', { name: 'Seek', exact: true }).click();
  await Promise.all([
    director.waitForFunction(() => Math.abs(window.__ytPlayers.at(-1)?.getCurrentTime() - 123) < 1),
    output.waitForFunction(() => Math.abs(window.__ytPlayers.at(-1)?.getCurrentTime() - 123) < 1),
  ]);
  await director.getByRole('button', { name: 'Ⅱ Pause', exact: true }).click();
  await Promise.all([
    director.waitForFunction(() => window.__ytPlayers.at(-1)?.getPlayerState() === 2),
    output.waitForFunction(() => window.__ytPlayers.at(-1)?.getPlayerState() === 2),
  ]);
  const savedPosition = await output.evaluate(() => window.__ytPlayers.at(-1).getCurrentTime());
  assert.ok(savedPosition >= 123 && savedPosition < 150, `Pause should preserve the sought point before switching, got ${savedPosition}.`);
  await director.waitForFunction(position => Math.abs(window.__ytPlayers.at(-1)?.getCurrentTime() - position) < 1, savedPosition);
  console.log('YouTube ID and paused playback position are established before camera switching');

  await director.locator('.phone-invites summary').click();
  await director.getByRole('button', { name: 'Create phone links' }).click();
  const invites = {};
  for (const source of PHONE_SOURCES) {
    const invite = await director.locator(`#invite-${source}`).inputValue();
    const parsed = new URL(invite);
    assert.equal(parsed.pathname, '/youtube_overlay/phone');
    assert.equal(parsed.searchParams.get('source'), source);
    assert.ok(parsed.searchParams.get('token'));
    invites[source] = invite;
  }

  await Promise.all(phones.map((page, index) => page.goto(invites[PHONE_SOURCES[index]], { waitUntil: 'domcontentloaded' })));
  assert.deepEqual(await Promise.all(phones.map(page => page.evaluate(() => window.__captureCalls))), [0, 0, 0, 0]);
  assert.deepEqual(await Promise.all(phones.map(page => page.locator('.phone-preview-frame video').count())), [0, 0, 0, 0]);
  assert.equal(new URL(output.url()).searchParams.has('token'), false);
  for (const invite of Object.values(invites)) {
    const token = new URL(invite).searchParams.get('token');
    assert.equal((await output.content()).includes(token), false, 'Phone invite tokens must not reach public Output markup.');
  }

  await phones[3].evaluate(() => { window.__denyCapture = true; });
  await phones[3].getByRole('button', { name: 'Start camera' }).click();
  await phones[3].getByRole('alert').getByText(/permission was denied/i).waitFor();
  assert.equal(await phones[3].evaluate(() => window.__captureCalls), 1);
  assert.equal(await phones[3].locator('.phone-preview-frame video').count(), 0);
  await phones[3].evaluate(() => { window.__denyCapture = false; });
  await Promise.all([
    phones[0].getByRole('button', { name: 'Start camera' }).click(),
    phones[1].getByRole('button', { name: 'Start camera' }).click(),
    phones[2].getByRole('button', { name: 'Start camera' }).click(),
    phones[3].getByRole('button', { name: 'Start camera' }).click(),
  ]);
  await Promise.all(phones.map(page => page.getByText('Ready for director').waitFor({ timeout: 20000 })));
  assert.deepEqual(await Promise.all(phones.map(page => page.evaluate(() => window.__captureCalls))), [1, 1, 1, 2]);
  assert.deepEqual(await Promise.all(phones.map(page => page.locator('.phone-preview-frame video').evaluate(video => video.muted))), [true, true, true, true]);
  await Promise.all(phones.map(page => page.waitForFunction(() => document.querySelector('.phone-preview-frame video')?.srcObject instanceof MediaStream)));
  const senderStreamIds = Object.fromEntries(await Promise.all(PHONE_SOURCES.map(async (source, index) => [
    source,
    await phones[index].locator('.phone-preview-frame video').evaluate(video => video.srcObject.id),
  ])));
  assert.equal(new Set(Object.values(senderStreamIds)).size, 4, 'Each phone slot should own a distinct captured media stream.');
  await director.waitForFunction(() => ['Phone 1', 'Phone 2', 'Phone 3', 'Phone 4'].every(label => {
    const button = [...document.querySelectorAll('.source-choice')].find(item => item.getAttribute('aria-label') === label);
    return button?.querySelector('small')?.textContent === 'Live';
  }));
  console.log('All four private phone slots are simultaneously live; permission failure is clear and capture starts only after the user action');

  assert.equal(await director.getByLabel('Follow selected source audio').isChecked(), true, 'Audio should follow the selected video source by default.');
  await director.locator('.audio-mixer summary').click();
  const phoneOneVolume = director.getByLabel('Phone 1 volume');
  const volumeBox = await phoneOneVolume.boundingBox();
  assert.ok(volumeBox);
  await director.mouse.move(volumeBox.x + volumeBox.width * 0.92, volumeBox.y + volumeBox.height / 2);
  await director.mouse.down();
  await director.mouse.move(volumeBox.x + volumeBox.width * 0.36, volumeBox.y + volumeBox.height / 2, { steps: 4 });
  const draftVolume = Number(await phoneOneVolume.inputValue());
  assert.ok(draftVolume > 20 && draftVolume < 80, `Expected an in-flight volume draft, got ${draftVolume}.`);
  await director2.goto(`${base}/director`, { waitUntil: 'domcontentloaded' });
  await director2.getByText('Connected', { exact: true }).waitFor();
  await director2.waitForFunction(() => !document.querySelector('.source-choice[aria-label="Phone 2"]')?.disabled);
  await director2.locator('.source-choice[aria-label="Phone 2"]').click();
  await director.waitForFunction(value => Number(document.querySelector('[aria-label="Phone 1 volume"]')?.value) === value && document.querySelector('.source-choice[aria-label="Phone 2"]')?.getAttribute('aria-pressed') === 'true', draftVolume);
  await director.mouse.up();
  await director2.waitForFunction(value => Number(document.querySelector('[aria-label="Phone 1 volume"]')?.value) === value, draftVolume);
  assert.equal(Number(await director2.getByLabel('Phone 1 volume').inputValue()), draftVolume, 'The displayed volume draft must be the value persisted to Program state.');
  console.log('A concurrent Program source update preserves an in-flight per-input volume draft');

  await director.locator('.source-choice[aria-label="YouTube"]').click();
  await output.locator(`iframe[src*="/embed/${VIDEO_ID}"]`).waitFor();
  await output.waitForFunction(position => window.__ytPlayers.at(-1)?.getPlayerState() === 2 && Math.abs(window.__ytPlayers.at(-1)?.getCurrentTime() - position) < 1, savedPosition);
  assert.equal(new URL(await output.locator('iframe').evaluate(frame => frame.src)).searchParams.get('mute'), '0');
  console.log('Switching back to YouTube restores the same video at its saved paused position');

  const followAudio = director.getByLabel('Follow selected source audio');
  await followAudio.click();
  await director.waitForFunction(() => !document.querySelector('.follow-audio input')?.checked);
  await director.getByLabel('Audio source').selectOption('phone1');
  await output.waitForFunction(() => {
    const audio = document.querySelector('audio');
    return audio?.srcObject?.getAudioTracks().some(track => track.readyState === 'live') && audio.srcObject.getVideoTracks().length === 0;
  }, null, { timeout: 20000 });
  const visibleYouTube = output.locator(`iframe[src*="/embed/${VIDEO_ID}"]`);
  const youtubeBox = await visibleYouTube.boundingBox();
  assert.ok(youtubeBox && youtubeBox.width > 0 && youtubeBox.height > 0, 'YouTube must remain the visible video when its audio is not selected.');
  assert.equal(await output.evaluate(() => window.__ytPlayers.at(-1)?.muted), true, 'The visible YouTube player must be muted when phone audio is selected.');
  assert.equal(await output.evaluate(() => window.__ytPlayers.at(-1)?.volume), 0);
  assert.equal(await output.locator('.camera-output iframe').count(), 0, 'YouTube audio must not come from an additional hidden player.');
  await followAudio.click();
  await director.waitForFunction(() => document.querySelector('.follow-audio input')?.checked);
  console.log('A manually selected phone microphone arrives as audio-only while the YouTube video remains visible and muted');

  await director.getByRole('button', { name: 'Load built-in test graphic' }).click();
  await director.waitForFunction(() => !document.querySelector('.take-button').disabled);
  await director.getByLabel('Image layout').selectOption('image');
  await director.locator('.take-button').click();
  await output.locator('.output-shell.graphic-mode.layout-image').waitFor();
  await output.evaluate(() => { window.__blockCameraAutoplay = true; });

  await director.locator('.source-choice[aria-label="Phone 1"]').click();
  await waitForCameraSource(output, 'phone1', senderStreamIds.phone1);
  await output.waitForFunction(value => Math.abs(document.querySelector('audio')?.volume - value / 100) < 0.01, draftVolume);
  const phoneOneMixerRow = director.locator('.audio-mixer-row').filter({ hasText: 'Phone 1' });
  await phoneOneMixerRow.getByRole('button').click();
  await output.locator('audio').waitFor({ state: 'detached' });
  assert.equal(await output.locator('.camera-output video').evaluate(video => video.srcObject.getVideoTracks().some(track => track.readyState === 'live')), true, 'Muting the microphone must leave its live video connected.');
  await phoneOneMixerRow.getByRole('button').click();
  await output.locator('audio').waitFor({ state: 'attached' });
  await output.waitForFunction(() => document.querySelector('audio')?.srcObject?.getAudioTracks().some(track => track.readyState === 'live'));
  await output.waitForFunction(value => Math.abs(document.querySelector('audio')?.volume - value / 100) < 0.01, draftVolume);
  await output.getByRole('button', { name: 'Start camera' }).waitFor();
  await output.locator('.output-shell.graphic-mode.layout-image').waitFor();
  await output.getByRole('button', { name: 'Start camera' }).click();
  await output.waitForFunction(() => {
    const video = document.querySelector('.camera-output video');
    return video && !video.paused;
  });

  for (const source of PHONE_SOURCES.slice(1)) {
    await director.locator(`.source-choice[aria-label="${PHONE_LABELS[source]}"]`).click();
    await waitForCameraSource(output, source, senderStreamIds[source]);
  }
  assert.equal(await output.evaluate(() => window.__webrtcPeers.some(peer => peer.connectionState === 'connected' && peer.getTransceivers().some(transceiver => transceiver.receiver.track?.kind === 'video'))), true);
  console.log('Each live phone sends real native WebRTC video to Output over the selected image layout; camera autoplay has a working user-gesture recovery');

  await output.evaluate(() => window.__forceLatestVideoPeerFailed());
  await output.locator(`iframe[src*="/embed/${VIDEO_ID}"]`).waitFor();
  const cameraFailure = output.locator('.camera-recovery.camera-error');
  await cameraFailure.getByText(/Showing saved YouTube/i).waitFor();
  await cameraFailure.getByRole('button', { name: 'Retry camera' }).waitFor();
  assert.equal(await output.locator('.output-shell.graphic-mode.layout-image').count(), 1);
  await cameraFailure.getByRole('button', { name: 'Retry camera' }).click();
  await waitForCameraSource(output, 'phone4', senderStreamIds.phone4);
  await output.locator('.camera-recovery.camera-error').waitFor({ state: 'detached' });
  console.log('A failed native video peer shows saved YouTube plus Retry camera; retry recovers the live source');

  await phones[3].getByRole('button', { name: 'Stop camera' }).click();
  await output.locator(`iframe[src*="/embed/${VIDEO_ID}"]`).waitFor();
  await director.getByText(/Phone 4 disconnected\. Output returned to the saved YouTube video\./).waitFor();
  await output.waitForFunction(position => window.__ytPlayers.at(-1)?.getPlayerState() === 2 && Math.abs(window.__ytPlayers.at(-1)?.getCurrentTime() - position) < 1, savedPosition);
  console.log('Selected phone disconnect falls back to the saved YouTube ID and position');

  await director.getByRole('button', { name: 'Start webcam' }).click();
  await director.locator('.camera-state.camera-ready').waitFor();
  assert.equal(await director.evaluate(() => window.__captureCalls), 1, 'Director camera capture should start only after clicking Start webcam.');
  await director.waitForFunction(() => document.querySelector('.director-local-preview')?.srcObject instanceof MediaStream);
  const directorStreamId = await director.locator('.director-local-preview').evaluate(video => video.srcObject.id);
  await director.locator('.source-choice[aria-label="Director webcam"]').click();
  await waitForCameraSource(output, 'director', directorStreamId);
  console.log('The Director webcam also sends live native WebRTC media to Output');

  await stop();
  await director.waitForFunction(() => !document.querySelector('#invite-phone1'), null, { timeout: 10000 });
  await start();
  await Promise.all([
    director.getByText('Connected', { exact: true }).waitFor({ timeout: 20000 }),
    output.locator(`iframe[src*="/embed/${VIDEO_ID}"]`).waitFor({ timeout: 30000 }),
    director.locator('.camera-state.camera-ready').waitFor({ timeout: 20000 }),
  ]);
  await director.getByText('SSO · multi-input-test@example.test').waitFor();
  await director.waitForFunction(() => document.querySelector('.source-choice[aria-label="Director webcam"] small')?.textContent === 'Live');
  await director.locator('.source-choice[aria-label="Director webcam"]').click();
  await waitForCameraSource(output, 'director', directorStreamId);
  await Promise.all(phones.slice(0, 3).map(page => page.getByRole('alert').getByText(/invalid or expired/i).waitFor({ timeout: 20000 })));
  await director.getByRole('button', { name: 'Create phone links' }).click();
  for (const source of PHONE_SOURCES) {
    const refreshed = new URL(await director.locator(`#invite-${source}`).inputValue());
    assert.notEqual(refreshed.searchParams.get('token'), new URL(invites[source]).searchParams.get('token'), 'Phone invite tokens must expire on server restart.');
  }
  console.log('Director webcam reconnects with its SSO claim; restart clears displayed invites and expires phone tokens');

  assert.deepEqual(errors, []);
  console.log(`Controlled peer failure/restart produced ${expectedNativeNetworkErrors.length} stackless Chromium WebRTC NetworkError event(s); application fallback/retry checks passed.`);
  console.log('Multi-input browser regressions passed with native fake-device media');
} catch (error) {
  const outputState = await output.evaluate(() => ({
    source: document.querySelector('.camera-output video')?.getAttribute('aria-label'),
    videoWidth: document.querySelector('.camera-output video')?.videoWidth,
    videoTracks: document.querySelector('.camera-output video')?.srcObject?.getVideoTracks().map(track => track.readyState),
    audioTracks: document.querySelector('audio')?.srcObject?.getAudioTracks().map(track => track.readyState),
    youtube: window.__ytPlayers?.map(player => ({ state: player.getPlayerState(), time: player.getCurrentTime(), muted: player.muted, volume: player.volume })),
    peers: window.__webrtcPeers?.map(peer => ({ state: peer.connectionState, tracks: peer.getTransceivers().map(transceiver => transceiver.receiver.track?.kind) })),
    alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent),
  })).catch(() => null);
  console.error('Input regression failure evidence', { outputState, directorAlerts: await director.locator('[role="alert"]').allTextContents().catch(() => []) });
  throw error;
} finally {
  await browser.close();
  await stop();
  rmSync(temp, { recursive: true, force: true });
}

async function waitForCameraSource(page, source, senderStreamId) {
  await page.waitForFunction(({ source, senderStreamId }) => {
    const video = document.querySelector('.camera-output video');
    const audio = document.querySelector('audio');
    return video?.getAttribute('aria-label') === `${source} live camera` &&
      video.videoWidth > 0 &&
      video.srcObject?.id === senderStreamId &&
      video.srcObject?.getVideoTracks().some(track => track.readyState === 'live') &&
      video.srcObject.getAudioTracks().length === 0 &&
      audio?.srcObject?.id === senderStreamId &&
      audio?.srcObject?.getAudioTracks().some(track => track.readyState === 'live') &&
      audio.srcObject.getVideoTracks().length === 0;
  }, { source, senderStreamId }, { timeout: 20000 });
}
