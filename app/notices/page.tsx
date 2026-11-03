import fs from 'node:fs';
import path from 'node:path';
import {LegalPage} from '@/components/LegalPage';
import {ThirdPartyNotices} from '@/components/ThirdPartyNotices';
export const metadata={title:'Third-party notices · OrionMail'};
export default function Notices(){const data=JSON.parse(fs.readFileSync(path.join(process.cwd(),'public/third-party-notices.json'),'utf8'));return <LegalPage title="Third-party notices" intro={data.scope} sections={[]}><ThirdPartyNotices entries={data.entries} texts={data.texts}/></LegalPage>;}
