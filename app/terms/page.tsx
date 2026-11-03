import {LegalPage} from '@/components/LegalPage';
import {termsSections} from '@/lib/legal-content';
export const metadata={title:'Terms of Use · OrionMail'};
export default function Terms(){return <LegalPage title="Terms of Use" intro="The terms for using OrionMail and its connected email features." sections={termsSections}/>;}
