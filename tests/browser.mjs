import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const prefix='/youtube_overlay';
const evidence=process.env.EVIDENCE_DIR ?? '.browser-evidence'; mkdirSync(evidence,{recursive:true});
const observations=[];
function record(message,data) { observations.push({message,...(data?{data}:{})}); console.log(message,data??''); }
let server, temp, port='0';
async function start() {
  server=spawn(process.execPath,['dist-server/server/index.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:port,BASE_PATH:prefix,DATA_PATH:path.join(temp,'overlay.sqlite')},stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Candidate did not start')),10000);
    server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127.0.0.1:(\d+)/);if(match){port=match[1];clearTimeout(timer);resolve(`http://127.0.0.1:${port}${prefix}`);}});
    server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited ${code}`));});
  });
}
async function stop() { if(server?.exitCode===null) await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');}); }
const base=process.env.BASE_URL?.replace(/\/$/,'') ?? await (async()=>{temp=mkdtempSync(path.join(tmpdir(),'overlay-browser-'));return start();})();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/local/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const directorContext=await browser.newContext({viewport:{width:1440,height:1100}});
const outputContext=await browser.newContext({viewport:{width:1440,height:900}});
const director=await directorContext.newPage(),output=await outputContext.newPage();
const pageErrors=[];for(const page of [director,output]) page.on('pageerror',error=>pageErrors.push(error.message));
const socketUrls=[];for(const page of [director,output])page.on('websocket',ws=>socketUrls.push(ws.url()));
const waitMode=mode=>output.locator(`.output-shell.${mode}-mode`).waitFor({timeout:20000});
const revision=async()=>Number((await director.locator('.revision').innerText()).replace('Revision ',''));
async function screenshot(name,page=output){await page.screenshot({path:path.join(evidence,`${name}.png`),fullPage:true});}
try {
  await Promise.all([director.goto(`${base}/director`),output.goto(`${base}/output`)]);
  await director.getByText('Connected',{exact:true}).waitFor();
  await director.locator('.live-button').click();await waitMode('live');
  await director.getByLabel('YouTube stream or video').fill('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  await director.getByRole('button',{name:'Set video',exact:true}).click();
  await output.waitForFunction(()=>document.querySelector('iframe')?.src.includes('/embed/aqz-KE-bpKQ'));
  record('Valid YouTube URL follows from Director to Output');
  const before=await revision();
  await director.getByRole('button',{name:'Load built-in test graphic',exact:true}).click();
  await director.waitForFunction(()=>!document.querySelector('.take-button').disabled);
  await waitMode('live');assert.equal(await revision(),before);
  await director.getByRole('button',{name:'Load built-in test graphic',exact:true}).click();
  await director.waitForFunction(()=>!document.querySelector('.take-button').disabled);
  assert.equal(await revision(),before);
  record('Built-in Preview does not change Program; reselecting the same asset remains usable');
  await director.locator('.take-button').click();await waitMode('graphic');
  await output.locator('.program-graphic img').waitFor();
  assert.equal(await output.locator('.program-graphic img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
  const playerBox=await output.locator('iframe').boundingBox();assert.ok(playerBox.width>200&&playerBox.height>100);
  await output.locator('iframe').evaluate(frame=>{frame.dataset.acceptanceIdentity='original-player';});
  await screenshot('01-graphic');
  await director.locator('.live-button').click();await waitMode('live');
  assert.equal(await output.locator('iframe').getAttribute('data-acceptance-identity'),'original-player');
  await director.locator('.take-button').click();await waitMode('graphic');
  assert.equal(await output.locator('iframe').getAttribute('data-acceptance-identity'),'original-player');
  record('TAKE displays loaded image plus visible YouTube; LIVE restores layout without remounting player',playerBox);
  await Promise.all([director.reload(),output.reload()]);
  await director.getByText('Connected',{exact:true}).waitFor();await waitMode('graphic');
  await director.locator('.program-badge.graphic').waitFor();
  assert.equal(await director.locator('.empty-preview').count(),1);
  record('Both pages restore canonical graphic Program after reload; Preview remains local');
  const savedRevision=await revision();
  await director.getByLabel('YouTube stream or video').fill('https://example.com/watch?v=wrong');
  await director.getByRole('button',{name:'Set video',exact:true}).click();
  await director.getByText('Enter a valid YouTube URL or 11-character video ID.').waitFor();assert.equal(await revision(),savedRevision);
  record('Invalid YouTube input rejected visibly without mutating Program');
  await director.getByLabel('Search Wikimedia Commons').fill('mountain');
  await director.getByRole('button',{name:'Search',exact:true}).click();
  await director.locator('.asset-grid .asset-card').first().waitFor({timeout:25000});
  const realAssetTitle=await director.locator('.asset-grid .asset-card span').first().innerText();
  const thumbnails=await director.locator('.asset-grid img').evaluateAll(images=>images.map(img=>({src:img.src,loaded:img.complete&&img.naturalWidth>0})));
  await director.locator('.asset-grid .asset-card').first().click();
  await director.waitForFunction(()=>!document.querySelector('.take-button').disabled,{},{timeout:25000});
  assert.equal(await revision(),savedRevision);
  await director.locator('.preview-panel .attribution a').first().waitFor();
  await director.getByRole('button',{name:'Favorite Preview',exact:true}).click();
  await director.getByRole('button',{name:'Unfavorite Preview',exact:true}).waitFor();
  await director.locator('.take-button').click();
  await output.getByRole('img',{name:realAssetTitle,exact:true}).waitFor();
  await output.waitForFunction(()=>{const img=document.querySelector('.program-graphic img');return img?.complete&&img.naturalWidth>0;},{},{timeout:20000});
  await screenshot('02-search-taken');await screenshot('03-director-library',director);
  record('Real Wikimedia search returns usable images/attribution; selection is local, favorite saves, TAKE uses selected image',{title:realAssetTitle,thumbnails});
  await director.getByRole('tab',{name:'Recent',exact:true}).click();
  await director.getByRole('button',{name:`Preview ${realAssetTitle}`,exact:true}).waitFor();
  if(server || process.env.RESTART_SERVICE) {
    if(server){await stop();await new Promise(resolve=>setTimeout(resolve,600));await start();}
    else execFileSync('sudo',['-n','systemctl','restart',process.env.RESTART_SERVICE],{timeout:30000});
    await director.getByText('Connected',{exact:true}).waitFor({timeout:25000});await waitMode('graphic');
    await Promise.all([director.reload(),output.reload()]);
    await director.getByText('Connected',{exact:true}).waitFor();await waitMode('graphic');
    await output.getByRole('img',{name:realAssetTitle,exact:true}).waitFor();
    await director.getByRole('tab',{name:'Favorites',exact:true}).click();await director.getByRole('button',{name:`Preview ${realAssetTitle}`,exact:true}).waitFor();
    await director.getByRole('tab',{name:'Recent',exact:true}).click();await director.getByRole('button',{name:`Preview ${realAssetTitle}`,exact:true}).waitFor();
    record('Actual server restart: sockets reconnect, Program/favorites/recent survive and recover after page reload');
  } else record('Server restart skipped: external target with no RESTART_SERVICE authorization supplied');
  await outputContext.setOffline(true);
  await output.locator('.connection-ribbon').waitFor({timeout:55000});
  await director.locator('.live-button').click();
  await outputContext.setOffline(false);await waitMode('live');
  await output.locator('.connection-ribbon').waitFor({state:'hidden',timeout:20000});
  record('Browser network loss shows reconnect state and catches up to latest Program after network recovery');
  await director.getByRole('button',{name:'Load built-in test graphic',exact:true}).click();
  await director.waitForFunction(()=>!document.querySelector('.take-button').disabled);
  for(let i=0;i<5;i++){await director.locator('.take-button').click();await waitMode('graphic');await director.locator('.live-button').click();await waitMode('live');}
  record('Five repeated TAKE/LIVE cycles complete');
  await director.route('**/api/images/search?*',route=>route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Acceptance test: provider unavailable'})}));
  await director.getByLabel('Search Wikimedia Commons').fill('provider outage');await director.getByRole('button',{name:'Search',exact:true}).click();
  await director.getByText('Acceptance test: provider unavailable').waitFor();
  assert.equal(await director.locator('.live-button').isEnabled(),true);
  await director.locator('.take-button').click();await waitMode('graphic');await director.locator('.live-button').click();await waitMode('live');
  await director.unroute('**/api/images/search?*');
  await director.route('**/api/images/search?*',route=>route.fulfill({status:200,contentType:'application/json',body:'{"assets":[]}'}));
  await director.getByLabel('Search Wikimedia Commons').fill('no results');await director.getByRole('button',{name:'Search',exact:true}).click();
  await director.getByText('No images found. Try another search.').waitFor();
  record('Injected provider failure and empty results are visible; TAKE/LIVE remain usable');
  await director.unroute('**/api/images/search?*');
  // Reload the normal Output to observe real YouTube startup and controls.
  await output.reload();await output.locator('.player-controls').waitFor();
  await new Promise(resolve=>setTimeout(resolve,17000));
  const beforeStart=await output.locator('.player-controls [role="status"]').innerText();
  await output.getByRole('button',{name:'Start video',exact:true}).click();
  await new Promise(resolve=>setTimeout(resolve,4000));
  const afterStart=await output.locator('.player-controls [role="status"]').innerText();
  const frameText=await output.frames().find(frame=>frame.url().includes('youtube.com/embed/'))?.locator('body').innerText({timeout:3000}).catch(()=> 'Frame inaccessible');
  record('Real YouTube startup observation (playback/audio must be assessed from these results)',{beforeStart,afterStart,frameText:frameText?.slice(0,1200)});
  await screenshot('04-live-player');
  // Deterministic player API event injection verifies recovery UI, without claiming real playback.
  const recoveryContext=await browser.newContext();
  await recoveryContext.addInitScript(()=>{window.YT={Player:class {
    constructor(frame,{events}){this.events=events;setTimeout(()=>{events.onReady({target:this});events.onAutoplayBlocked({target:this});},50);}
    mute(){} unMute(){} playVideo(){if(this.started)this.events.onStateChange({data:1,target:this});this.started=true;}
    pauseVideo(){this.events.onStateChange({data:2,target:this});} seekTo(){} getCurrentTime(){return 0;} getDuration(){return 0;} getPlayerState(){return this.started?1:-1;} destroy(){}
  }};});
  const recovery=await recoveryContext.newPage();await recovery.goto(`${base}/output`);
  await recovery.getByText('Autoplay blocked. Press Start video to play with sound.').waitFor();
  await recovery.getByRole('button',{name:'Start video',exact:true}).click();await recovery.getByText('Playing',{exact:true}).waitFor();
  await recovery.getByRole('button',{name:'Retry player',exact:true}).click();await recovery.getByText('Autoplay blocked. Press Start video to play with sound.').waitFor();
  await recoveryContext.close();record('Simulated YouTube autoplay-blocked event exposes Start video and Retry player; Start dispatches playback command');
  // Unfavorite the acceptance asset using the real UI.
  await director.getByRole('tab',{name:'Favorites',exact:true}).click();await director.getByRole('button',{name:`Preview ${realAssetTitle}`,exact:true}).click();
  await director.getByRole('button',{name:'Unfavorite Preview',exact:true}).click();await director.getByRole('button',{name:'Favorite Preview',exact:true}).waitFor();
  await director.setViewportSize({width:390,height:844});await screenshot('05-director-mobile',director);
  assert.equal(await director.locator('.live-button').isVisible(),true);assert.equal(await director.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await output.setViewportSize({width:390,height:844});await director.getByRole('button',{name:'Load built-in test graphic',exact:true}).click();await director.waitForFunction(()=>!document.querySelector('.take-button').disabled);await director.locator('.take-button').click();await waitMode('graphic');
  const smallPlayer=await output.locator('iframe').boundingBox();assert.ok(smallPlayer.width>200&&smallPlayer.height>100);await screenshot('06-output-mobile-graphic');
  await director.locator('.live-button').click();await waitMode('live');
  record('390px layouts keep controls accessible and YouTube visible',smallPlayer);
  assert.deepEqual(pageErrors,[]);record('No uncaught browser page errors; public/browser Socket.IO paths observed',socketUrls);
  const health=await (await fetch(`${base}/api/healthz`)).json();record('Final health and build identity',health);
  writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify({base,passed:true,observations,pageErrors,socketUrls},null,2)+'\n');
} catch(error) {
  await screenshot('failure-director',director).catch(()=>{});await screenshot('failure-output',output).catch(()=>{});
  writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify({base,passed:false,error:String(error),observations,pageErrors},null,2)+'\n');throw error;
} finally { await browser.close();await stop();if(temp)rmSync(temp,{recursive:true,force:true}); }
