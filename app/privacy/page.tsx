import {LegalPage} from '@/components/LegalPage';
import {privacySections} from '@/lib/legal-content';
export const metadata={title:'Privacy Policy · OrionMail'};
export default function Privacy(){return <LegalPage title="Privacy Policy" intro="How OrionMail accesses, uses and stores information when you connect your email." sections={privacySections}/>;}
