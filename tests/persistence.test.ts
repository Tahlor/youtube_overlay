import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LibraryStore } from '../server/library.js';
import { ProgramStore } from '../server/programState.js';
const asset = { id:'one',title:'One',fullUrl:'https://upload.wikimedia.org/one.jpg',source:'Wikimedia Commons',sourceUrl:'https://commons.wikimedia.org/wiki/File:One.jpg',author:'Creator',license:'CC BY-SA' };
test('SQLite restores favorites, usage, attribution and full Program after reopen', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'overlay-db-'));
  try {
    let db=new LibraryStore(path.join(dir,'state.sqlite'));
    const state=new ProgramStore(); state.setVideo('aqz-KE-bpKQ'); state.take(asset);
    db.favorite(asset,true); db.used(asset); db.used(asset); db.saveProgram(state.getState()); db.close();
    db=new LibraryStore(path.join(dir,'state.sqlite'));
    assert.deepEqual(new ProgramStore(db.readProgram()).getState(),state.getState());
    assert.deepEqual(db.list().favorites[0].asset,asset);
    assert.equal(db.list().recent[0].useCount,2); assert.ok(db.list().recent[0].lastUsed);
    const second={...asset,id:'two',title:'Two'}; db.used(second);
    assert.equal(db.list().recent[0].asset.id,'two');
    db.favorite(asset,false); assert.equal(db.list().favorites.length,0); assert.equal(db.list().recent.length,2);
    db.close();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('unsafe assets and malformed snapshots are rejected without state mutation', () => {
  const program=new ProgramStore();
  for (const fullUrl of ['javascript:alert(1)','data:image/svg+xml,bad','//evil.test/a','/\\evil.test','http://evil.test/a']) {
    assert.throws(()=>program.take({...asset,fullUrl})); assert.equal(program.getState().revision,0);
  }
  assert.throws(()=>new ProgramStore({videoId:'invalid',mode:'live',activeAsset:null,revision:1}));
  assert.throws(()=>new ProgramStore({videoId:null,mode:'graphic',activeAsset:null,revision:1}));
  const copy=program.take(asset); copy.activeAsset!.title='mutated'; assert.equal(program.getState().activeAsset!.title,'One');
});
