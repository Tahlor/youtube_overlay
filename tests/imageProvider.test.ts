import assert from 'node:assert/strict';
import test from 'node:test';
import { WikimediaProvider } from '../server/imageProvider.js';
const response={query:{pages:{'123':{pageid:123,index:1,title:'File:Mountain.jpg',imageinfo:[{url:'https://upload.wikimedia.org/original.jpg',thumburl:'https://thumb.wikimedia.org/thumb.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Mountain.jpg',mime:'image/jpeg',extmetadata:{Artist:{value:'<a href="x">Creator &amp; friend</a>'},LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'}}}]}}}};
test('provider normalizes images with usable thumbnails and plain attribution', async () => {
  let requested='';
  const provider=new WikimediaProvider((async (url) => { requested=String(url); return Response.json(response); }) as typeof fetch);
  const assets=await provider.search('mountain');
  assert.match(requested,/gsrnamespace=6/); assert.equal(assets.length,1);
  assert.equal(assets[0].author,'Creator & friend'); assert.equal(assets[0].license,'CC BY-SA 4.0');
  assert.ok(assets[0].thumbnailUrl); assert.ok(assets[0].sourceUrl);
});
test('empty results, upstream HTTP errors and API errors are distinguishable', async () => {
  const mock=(data: unknown,status=200)=>new WikimediaProvider((async()=>Response.json(data,{status})) as typeof fetch);
  assert.deepEqual(await mock({}).search('none'),[]);
  await assert.rejects(mock({},429).search('x'),/HTTP 429/);
  await assert.rejects(mock({error:{code:'failed'}}).search('x'),/could not complete/);
});

test('provider rejects non-Wikimedia images and preserves empty results', async () => {
  const data=structuredClone(response); data.query.pages['123'].imageinfo[0].thumburl='https://elsewhere.test/tracker.jpg';
  const provider=new WikimediaProvider((async()=>Response.json(data)) as typeof fetch);
  assert.deepEqual(await provider.search('mountain'),[]);
});
