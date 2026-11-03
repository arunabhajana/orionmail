import fs from 'node:fs';
import path from 'node:path';
import {LegalPage} from '@/components/LegalPage';
export const metadata={title:'MIT License · OrionMail'};
export default function License(){return <LegalPage title="MIT License" intro="OrionMail’s original code is open source. Third-party dependencies retain their own licenses." sections={[["Permission and warranty",fs.readFileSync(path.join(process.cwd(),'LICENSE'),'utf8')]]}/>;}
