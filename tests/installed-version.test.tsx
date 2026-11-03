import {renderHook,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({native:true,version:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>api.native}));
vi.mock('@tauri-apps/api/app',()=>({getVersion:api.version}));
import {useInstalledVersion} from '@/hooks/useInstalledVersion';
import info from '@/package.json';
beforeEach(()=>{api.native=true;api.version.mockReset();});
it('uses the installed native app version rather than assuming the bundled package version',async()=>{
 api.version.mockResolvedValue('1.2.3');const {result}=renderHook(()=>useInstalledVersion());await waitFor(()=>expect(result.current).toBe('1.2.3'));
});
it('uses the build version in browser previews without calling native commands',()=>{
 api.native=false;const {result}=renderHook(()=>useInstalledVersion());expect(result.current).toBe(info.version);expect(api.version).not.toHaveBeenCalled();
});
