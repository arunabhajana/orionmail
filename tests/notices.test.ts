import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
it('bundled third-party notices have unique packages and intact notice text',()=>{
 const data=JSON.parse(fs.readFileSync('public/third-party-notices.json','utf8'));
 expect(data.entries.length).toBeGreaterThan(0);const keys=new Set();
 for(const entry of data.entries){const key=`${entry.ecosystem}:${entry.name}@${entry.version}`;expect(keys.has(key)).toBe(false);keys.add(key);expect(entry.notices.length).toBeGreaterThan(0);for(const notice of entry.notices){const text=data.texts[notice.text];expect(typeof text).toBe('string');expect(createHash('sha256').update(text).digest('hex')).toBe(notice.text);}}
});
