import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {validateReleaseTag} from './release/git-tag.mjs';
import {ROOT,checkVersions} from './release/lib.mjs';
const run=(args,env={})=>spawnSync(process.execPath,['scripts/distribute.mjs',...args],{cwd:ROOT,encoding:'utf8',env:{...process.env,...env}});
test('release validation restores checkout-flattened annotations and rejects lightweight or moved tags',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orion-tags-'));
 const git=(...args)=>execFileSync('git',['-c',`safe.directory=${dir}`,...args],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  git('init');git('config','user.name','Release test');git('config','user.email','release@example.com');
  git('commit','--allow-empty','-m','Initial');
  const first=git('rev-parse','HEAD');
  git('tag','-a','v0.1.0','-m','Release');
  const remote=path.join(dir,'remote.git');git('init','--bare',remote);git('remote','add','origin',remote);
  git('push','origin','refs/tags/v0.1.0');
  // Model checkout's +<event commit>:refs/tags/<tag> fallback.
  git('update-ref','refs/tags/v0.1.0',first);
  assert.throws(()=>validateReleaseTag(dir,'v0.1.0'),/annotated/);
  validateReleaseTag(dir,'v0.1.0',{refresh:true});
  assert.equal(git('cat-file','-t','refs/tags/v0.1.0'),'tag');
  git('tag','v0.2.0');git('push','origin','refs/tags/v0.2.0');
  assert.throws(()=>validateReleaseTag(dir,'v0.2.0',{refresh:true}),/annotated/);
  git('commit','--allow-empty','-m','Next');
  assert.throws(()=>validateReleaseTag(dir,'v0.1.0',{refresh:true}),/checked-out commit/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('release distribution rejects mismatched tags and missing signing setup',()=>{
 const tag=run(['validate'],{GITHUB_REF_NAME:'v0.0.0'});assert.notEqual(tag.status,0);assert.match(tag.stderr,/Tag does not match/);
 const config=run(['config'],{TAURI_SIGNING_PRIVATE_KEY:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''});assert.notEqual(config.status,0);assert.match(config.stderr,/Missing release secret/);
});
test('updater manifest accepts only the current signed Windows version and expected release host',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orion-distribute-'));const file=path.join(dir,'latest.json'),version=checkVersions();
 try{
  const manifest={version,platforms:{'windows-x86_64':{signature:'test-signature',url:`https://github.com/arunabhajana/orionmail/releases/download/v${version}/OrionMail-setup.exe`}}};
  fs.writeFileSync(file,JSON.stringify(manifest));assert.equal(run(['manifest',file],{GITHUB_REPOSITORY:'arunabhajana/orionmail'}).status,0);
  manifest.platforms['windows-x86_64'].url='https://github.com/arunabhajana/orionmail/releases/latest/download/OrionMail-setup.exe';fs.writeFileSync(file,JSON.stringify(manifest));assert.match(run(['manifest',file],{GITHUB_REPOSITORY:'arunabhajana/orionmail'}).stderr,/Pass tagName/);
  manifest.platforms['windows-x86_64'].url=`https://github.com/arunabhajana/orionmail/releases/download/v${version}/OrionMail-setup.exe`;
  manifest.version='0.0.0';fs.writeFileSync(file,JSON.stringify(manifest));assert.match(run(['manifest',file],{GITHUB_REPOSITORY:'arunabhajana/orionmail'}).stderr,/manifest version/);manifest.version=version;
  manifest.platforms['windows-x86_64'].signature='';fs.writeFileSync(file,JSON.stringify(manifest));assert.notEqual(run(['manifest',file],{GITHUB_REPOSITORY:'arunabhajana/orionmail'}).status,0);
  manifest.platforms['windows-x86_64'].signature='signature';manifest.platforms['windows-x86_64'].url='https://example.com/setup.exe';fs.writeFileSync(file,JSON.stringify(manifest));assert.notEqual(run(['manifest',file],{GITHUB_REPOSITORY:'arunabhajana/orionmail'}).status,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
