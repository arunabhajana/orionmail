import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './release/lib.mjs';
test('Windows release keeps branded installer assets with updater overlay',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(ROOT,'src-tauri/tauri.conf.json'),'utf8'));
 const nsis=config.bundle.windows.nsis;
 for(const [key,width,height] of [['headerImage',150,57],['sidebarImage',164,314]]){
  const bitmap=fs.readFileSync(path.join(ROOT,'src-tauri',nsis[key]));
  assert.equal(bitmap.toString('ascii',0,2),'BM');
  assert.equal(bitmap.readInt32LE(18),width);assert.equal(bitmap.readInt32LE(22),height);
  assert.equal(bitmap.readUInt16LE(28),24);
 }
 assert.ok(fs.existsSync(path.join(ROOT,'src-tauri',nsis.installerIcon)));
 assert.equal(nsis.installMode,'currentUser');assert.equal(config.bundle.createUpdaterArtifacts,true);
 const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/release.yml'),'utf8');
 assert.match(workflow,/--config .release-output\/tauri.release.json --bundles nsis/);
 const distribution=fs.readFileSync(path.join(ROOT,'scripts/distribute.mjs'),'utf8');
 assert.match(distribution,/plugins:\{updater:\{pubkey\}\}/);
});
