import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT,checkVersions,loadReleases,requirePublishable} from './release/lib.mjs';
const [command,file]=process.argv.slice(2);
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${ROOT}`,...args],{cwd:ROOT,encoding:'utf8'}).trim();
try{
 const version=checkVersions();
 if(command==='validate'){
  const tag=process.env.GITHUB_REF_NAME;
  if(tag!==`v${version}`)throw new Error('Tag does not match application version.');
  git('merge-base','--is-ancestor','HEAD','origin/master');
  if(git('cat-file','-t',`refs/tags/${tag}`)!=='tag')throw new Error('Use an annotated release tag.');
  const release=loadReleases().find(r=>r.version===version);if(!release)throw new Error('Missing release notes');requirePublishable(release);
 }else if(command==='config'){
  for(const name of ['TAURI_SIGNING_PRIVATE_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'])if(!process.env[name])throw new Error(`Missing release secret: ${name}`);
  const pubkey=process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();
  if(!pubkey)throw new Error('Set the Tauri updater public key.');
  if(!Buffer.from(pubkey,'base64').toString().includes('untrusted comment:'))throw new Error('Invalid Tauri public key.');
  fs.mkdirSync(path.join(ROOT,'.release-output'),{recursive:true});
  fs.writeFileSync(path.join(ROOT,'.release-output/tauri.release.json'),JSON.stringify({plugins:{updater:{pubkey}}},null,2));
 }else if(command==='manifest'){
  const manifest=JSON.parse(fs.readFileSync(file,'utf8')),platform=manifest.platforms?.['windows-x86_64'];
  if(manifest.version!==version||!platform?.signature?.trim()||!platform.url?.startsWith(`https://github.com/${process.env.GITHUB_REPOSITORY}/releases/download/v${version}/`))throw new Error('Updater manifest must contain the current updater-signed Windows release.');
 }else if(command==='start'){
  const next=process.argv[3];if(!next||!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(next))throw new Error('Supply patch, minor, major or a version.');
  if(git('status','--porcelain'))throw new Error('Start from a clean checkout.');
  if(git('branch','--show-current')!=='master')throw new Error('Start from master.');
  git('switch','-c',`orionmail/release-${next}-${Date.now()}`);
  for(const args of [['bump',next],['notes'],['generate']])execFileSync(process.execPath,['scripts/release.mjs',...args],{cwd:ROOT,stdio:'inherit'});
 }else throw new Error('Use validate, config, manifest or start.');
 console.log(`${command} completed.`);
}catch(error){console.error(error.message);process.exitCode=1;}
