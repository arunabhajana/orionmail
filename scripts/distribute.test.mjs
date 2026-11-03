import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT,checkVersions} from './release/lib.mjs';
const run=(args,env={})=>spawnSync(process.execPath,['scripts/distribute.mjs',...args],{cwd:ROOT,encoding:'utf8',env:{...process.env,...env}});
test('release distribution rejects mismatched tags and missing signing setup',()=>{
 const tag=run(['validate'],{GITHUB_REF_NAME:'v0.0.0'});assert.notEqual(tag.status,0);assert.match(tag.stderr,/Tag does not match/);
 const config=run(['config'],{TAURI_SIGNING_PRIVATE_KEY:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''});assert.notEqual(config.status,0);assert.match(config.stderr,/Missing release secret/);
});
test('updater manifest accepts only the current signed Windows version and expected release host',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orion-distribute-'));const file=path.join(dir,'latest.json'),version=checkVersions();
 try{
  const manifest={version,platforms:{'windows-x86_64':{signature:'test-signature',url:`https://github.com/arunabhajana/orionmail/releases/download/v${version}/OrionMail-setup.exe`}}};
  fs.writeFileSync(file,JSON.stringify(manifest));assert.equal(run(['manifest',file],{GITHUB_REPOSITORY:'arunabhajana/orionmail'}).status,0);
  manifest.platforms['windows-x86_64'].signature='';fs.writeFileSync(file,JSON.stringify(manifest));assert.notEqual(run(['manifest',file],{GITHUB_REPOSITORY:'arunabhajana/orionmail'}).status,0);
  manifest.platforms['windows-x86_64'].signature='signature';manifest.platforms['windows-x86_64'].url='https://example.com/setup.exe';fs.writeFileSync(file,JSON.stringify(manifest));assert.notEqual(run(['manifest',file],{GITHUB_REPOSITORY:'arunabhajana/orionmail'}).status,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
