import {render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({usePathname:()=>'/privacy'}));
import {PublicPageBoundary} from '@/components/PublicPageBoundary';
import {StorageUsage} from '@/components/settings/StorageUsage';
import {SettingRow} from '@/components/settings/SettingsControls';
it('shows public legal content without mounting desktop auth and native services',()=>{
 const desktop=vi.fn(()=> <p>Desktop</p>);const Desktop=desktop;
 render(<PublicPageBoundary desktop={<Desktop/>}><h1>Privacy Policy</h1></PublicPageBoundary>);
 expect(screen.getByRole('heading',{name:'Privacy Policy'})).toBeInTheDocument();expect(desktop).not.toHaveBeenCalled();
});
it('represents an empty cache without invalid chart widths',()=>{
 const {container}=render(<StorageUsage headers={0} bodies={0} formatBytes={bytes=>`${bytes} B`}/>);
 expect(screen.getByText('No cached message content yet.')).toBeInTheDocument();expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
});
it('shows measured totals and both storage categories',()=>{
 render(<StorageUsage headers={100} bodies={300} formatBytes={bytes=>`${bytes} B`}/>);
 expect(screen.getByText('400 B')).toBeInTheDocument();expect(screen.getByText('Headers & previews')).toBeInTheDocument();expect(screen.getByText('Message bodies')).toBeInTheDocument();
});
it('marks unfinished settings Coming Soon without exposing an active control',()=>{
 render(<SettingRow id="sync.history" title="Sync history" description="Not implemented" unavailable><button>Change</button></SettingRow>);
 expect(screen.getByText('Coming Soon')).toBeInTheDocument();expect(screen.queryByRole('button')).toBeNull();
});
