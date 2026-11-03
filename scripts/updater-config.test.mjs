import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT} from './release/lib.mjs';
test('updater configuration succeeds without a Windows certificate and still requires the updater key',()=>{
 const target=path.join(ROOT,'.release-output/tauri.release.json');const previous=fs.existsSync(target)?fs.readFileSync(target):null;
 const pubkey=Buffer.from('untrusted comment: test-only public key\nfixture').toString('base64');
 const env={...process.env,TAURI_SIGNING_PRIVATE_KEY:'test-only',GOOGLE_CLIENT_ID:'test-only',GOOGLE_CLIENT_SECRET:'test-only',TAURI_UPDATER_PUBLIC_KEY:pubkey,WINDOWS_CERTIFICATE_THUMBPRINT:'',WINDOWS_CERTIFICATE:'',WINDOWS_CERTIFICATE_PASSWORD:''};
 try{
  const valid=spawnSync(process.execPath,['scripts/distribute.mjs','config'],{cwd:ROOT,env,encoding:'utf8'});assert.equal(valid.status,0,valid.stderr);
  const config=JSON.parse(fs.readFileSync(target,'utf8'));assert.equal(config.plugins.updater.pubkey,pubkey);assert.equal(config.bundle?.windows,undefined);
  const missing=spawnSync(process.execPath,['scripts/distribute.mjs','config'],{cwd:ROOT,env:{...env,TAURI_SIGNING_PRIVATE_KEY:''},encoding:'utf8'});assert.notEqual(missing.status,0);assert.match(missing.stderr,/Missing release secret: TAURI_SIGNING_PRIVATE_KEY/);
 }finally{if(previous)fs.writeFileSync(target,previous);else fs.rmSync(target,{force:true});}
});
