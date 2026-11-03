import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ROOT} from './release/lib.mjs';
const metadata=JSON.parse(execFileSync('cargo',['metadata','--manifest-path','src-tauri/Cargo.toml','--locked','--filter-platform','x86_64-pc-windows-msvc','--format-version','1'],{cwd:ROOT,encoding:'utf8',maxBuffer:30e6}));
if(!process.env.npm_execpath)throw Error('Run npm run notices:generate');
const npm=JSON.parse(execFileSync(process.execPath,[process.env.npm_execpath,'ls','--omit=dev','--all','--json','--long'],{cwd:ROOT,encoding:'utf8',maxBuffer:30e6}));
const entries=[],texts={},seen=new Set(),missing=[];
function licenseFiles(directory){
 if(!fs.existsSync(directory))return [];
 const result=[];
 const walk=(dir,depth)=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,item.name);
  if(item.isFile()&&(depth>0||/^(licen[sc]e|copying|copyright|notice)([._-]|$)/i.test(item.name))){const text=fs.readFileSync(file,'utf8');if(!text.includes('\0'))result.push({name:path.relative(directory,file).replaceAll('\\','/'),text:text.replace(/\r\n/g,'\n')});}
  if(item.isDirectory()&&depth<2&&/^(licen[sc]es?|notices?)$/i.test(item.name))walk(file,depth+1);
 }};walk(directory,0);return result;
}
function add(ecosystem,name,version,license,dir,source,explicit){
 const id=`${ecosystem}:${name}@${version}`;if(seen.has(id))return;seen.add(id);
 let files=licenseFiles(dir);
 if(!files.length)files=licenseFiles(path.join(ROOT,'third-party-licenses',ecosystem,name.replaceAll('/','__'),version));
 if(explicit&&fs.existsSync(explicit)&&!files.some(f=>path.resolve(dir,f.name)===explicit))files.push({name:path.basename(explicit),text:fs.readFileSync(explicit,'utf8').replace(/\r\n/g,'\n')});
 if(!files.length)missing.push(id);
 const notices=files.map(file=>{const hash=createHash('sha256').update(file.text).digest('hex');texts[hash]=file.text;return {name:file.name,text:hash};});
 entries.push({ecosystem,name,version,license:license||'See upstream license',source,notices});
}
function visit(node){for(const [name,item] of Object.entries(node.dependencies||{})){
 if(item.path&&fs.existsSync(path.join(item.path,'package.json'))){const pkg=JSON.parse(fs.readFileSync(path.join(item.path,'package.json'),'utf8'));const license=typeof pkg.license==='string'?pkg.license:pkg.license?.type;add('npm',name,item.version,license,item.path,`https://www.npmjs.com/package/${name}/v/${item.version}`);}
 visit(item);
}}visit(npm);
for(const pkg of metadata.packages){if(metadata.workspace_members.includes(pkg.id))continue;add('Rust',pkg.name,pkg.version,pkg.license,path.dirname(pkg.manifest_path),`https://crates.io/crates/${pkg.name}/${pkg.version}`,pkg.license_file?path.resolve(path.dirname(pkg.manifest_path),pkg.license_file):undefined);}
add('Font','Inter','Google Fonts','OFL-1.1',path.join(ROOT,'third-party-licenses/Font/Inter/Google Fonts'),'https://github.com/google/fonts/tree/main/ofl/inter');
entries.sort((a,b)=>a.ecosystem.localeCompare(b.ecosystem)||a.name.localeCompare(b.name)||a.version.localeCompare(b.version));
if(missing.length){console.error('Missing license/notice sources:',missing.join(', '));process.exitCode=1;}
fs.writeFileSync(path.join(ROOT,'public/third-party-notices.json'),JSON.stringify({scope:'Production npm dependencies and locked Windows Rust dependencies, including build dependencies. Includes packaged and upstream license texts; archives without a standalone license include their published declaration and supplied notices. System components such as Windows and WebView2 have their own terms.',entries,texts},null,2)+'\n');
fs.writeFileSync(path.join(ROOT,'public/THIRD-PARTY-NOTICES.txt'),'OrionMail — Third-party notices\n\n'+entries.map(e=>`${e.ecosystem}: ${e.name} ${e.version}\nLicense: ${e.license}\n${e.source}\n\n`+e.notices.map(n=>`${n.name}\n${texts[n.text]}`).join('\n\n')).join('\n\n====================\n\n'));
console.log(`Generated notices for ${entries.length} packages; ${missing.length} missing notice sources.`);
