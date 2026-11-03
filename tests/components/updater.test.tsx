import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({check:vi.fn(),guard:vi.fn(),notify:vi.fn(),close:vi.fn(),install:vi.fn()}));
vi.mock('next/navigation',()=>({usePathname:()=>'/inbox'}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true}));
vi.mock('@tauri-apps/plugin-updater',()=>({check:api.check}));
vi.mock('@tauri-apps/plugin-notification',()=>({isPermissionGranted:async()=>true,requestPermission:async()=>'granted',sendNotification:api.notify}));
vi.mock('@/components/AuthContext',()=>({useAuth:()=>({prepareForUpdate:api.guard})}));
vi.mock('@/lib/generated/releases',()=>({currentRelease:{version:'0.2.0',sample:false,whatsNew:[{id:'feature'}]}}));
vi.mock('@/components/settings/ReleaseNotes',()=>({WhatsNewModal:({onClose}:{onClose:()=>void})=><button onClick={onClose}>What’s new</button>}));
import {UpdateProvider,useUpdates} from '@/components/UpdateProvider';
function Controls(){const updates=useUpdates();return <><button onClick={()=>{void updates.checkNow();}}>Check manually</button><p>{updates.status}</p></>;}
const app=()=>render(<UpdateProvider><Controls/></UpdateProvider>);
beforeEach(()=>{vi.stubEnv('NODE_ENV','production');localStorage.clear();api.check.mockReset();api.guard.mockReset();api.notify.mockReset();api.close.mockReset();api.install.mockReset();api.guard.mockResolvedValue(undefined);api.close.mockResolvedValue(undefined);api.install.mockResolvedValue(undefined);api.check.mockImplementation(async()=>({version:'0.3.0',close:api.close,downloadAndInstall:api.install}));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
it('checks on launch and hourly, defers the popup, and reopens it manually without duplicate notifications',async()=>{
 vi.useFakeTimers();app();await act(async()=>{await vi.advanceTimersByTimeAsync(0);});expect(api.check).toHaveBeenCalledOnce();expect(screen.getByRole('dialog')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Later'}));await act(async()=>{await vi.advanceTimersByTimeAsync(3600000);});expect(api.check).toHaveBeenCalledTimes(2);expect(screen.queryByRole('dialog')).toBeNull();expect(api.notify).toHaveBeenCalledOnce();
 await act(async()=>{fireEvent.click(screen.getByText('Check manually'));});expect(screen.getByRole('dialog')).toBeInTheDocument();expect(api.install).not.toHaveBeenCalled();
});
it('never installs when the unsaved-work guard fails and lets the user retry',async()=>{
 api.guard.mockRejectedValueOnce(new Error('Draft is not saved'));app();await screen.findByRole('dialog');fireEvent.click(screen.getByText('Update now'));await screen.findByRole('alert');expect(api.install).not.toHaveBeenCalled();expect(localStorage.getItem('orion_pending_update')).toBeNull();
 fireEvent.click(screen.getByText('Retry update'));await waitFor(()=>expect(api.install).toHaveBeenCalledOnce());expect(localStorage.getItem('orion_pending_update')).toBe('0.3.0');
});
it('shows bundled highlights once after a version change and updates the installed marker on dismissal',async()=>{
 api.check.mockResolvedValue(null);localStorage.setItem('orion_installed_version','0.1.0');app();fireEvent.click(await screen.findByText('What’s new'));expect(localStorage.getItem('orion_installed_version')).toBe('0.2.0');expect(screen.queryByText('What’s new')).toBeNull();
});
it('keeps the app usable after check failures',async()=>{
 api.check.mockRejectedValue(new Error('Offline'));app();await screen.findByText('Could not check for updates. We’ll retry automatically.');expect(screen.queryByRole('dialog')).toBeNull();
});
