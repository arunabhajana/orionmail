import {fireEvent,render,screen,waitFor,act} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {Pencil} from 'lucide-react';
const state=vi.hoisted(()=>({owner:'a',enabled:true,path:'/inbox',run:vi.fn(),guard:vi.fn(),push:vi.fn(),query:vi.fn(),switch:vi.fn(),folder:vi.fn(),unified:vi.fn(),request:vi.fn(),authorize:vi.fn()}));
vi.mock('@/components/AuthContext',()=>({useAuth:()=>({user:{id:state.owner},accounts:[{id:'a',name:'Personal',email:'a@example.com'},{id:'b',name:'Work',email:'b@example.com'}],accountBusy:false,prepareForUpdate:state.guard,switchAccount:state.switch})}));
vi.mock('@/components/MailboxViewContext',()=>({useMailboxView:()=>({unified:false,setFolder:state.folder,setUnified:state.unified,requestNavigation:state.request,authorizeNavigation:state.authorize})}));
vi.mock('@/components/AppPreferencesContext',()=>({useAppPreferences:()=>({preferences:{shortcutsEnabled:state.enabled},devicePreferences:{shortcutsEnabled:state.enabled}})}));
vi.mock('next/navigation',()=>({usePathname:()=>state.path,useRouter:()=>({push:state.push})}));
vi.mock('next-themes',()=>({useTheme:()=>({setTheme:vi.fn()})}));
import {CommandPaletteProvider,useMailboxCommands} from '@/components/CommandPalette';
import {SearchBar} from '@/components/inbox/EmailListHeader';
function Workspace(){useMailboxCommands(()=>[{id:'new.'+state.owner,label:'New message',group:'Compose',icon:Pencil,run:state.run}]);return <><SearchBar onChange={state.query}/><div contentEditable suppressContentEditableWarning aria-label="Message editor"/></>;}
const App=()=> <CommandPaletteProvider><Workspace/></CommandPaletteProvider>;
beforeEach(()=>{state.owner='a';state.enabled=true;state.path='/inbox';for(const mock of [state.run,state.guard,state.push,state.query,state.switch,state.folder,state.unified,state.request,state.authorize])mock.mockReset();state.guard.mockResolvedValue(undefined);state.switch.mockResolvedValue(undefined);state.request.mockReturnValue('nav-token');});
it('opens with Ctrl+K, ranks commands ahead of mail search and runs with Enter',async()=>{
 render(<App/>);fireEvent.keyDown(document.body,{key:'k',ctrlKey:true});const input=await screen.findByRole('combobox',{name:'Search commands or mail'});expect(input).toHaveFocus();fireEvent.change(input,{target:{value:'New message'}});fireEvent.keyDown(input,{key:'Enter'});await waitFor(()=>expect(state.run).toHaveBeenCalledOnce());
});
it('Ctrl+S focuses search and editor Ctrl+K retains its link shortcut',async()=>{
 render(<App/>);fireEvent.keyDown(document.body,{key:'s',ctrlKey:true});await waitFor(()=>expect(screen.getByRole('searchbox')).toHaveFocus());const editor=screen.getByLabelText('Message editor');fireEvent.keyDown(editor,{key:'k',ctrlKey:true});expect(screen.queryByRole('dialog')).toBeNull();
});
it('searches mail from the palette without calling native mail actions',async()=>{
 render(<App/>);fireEvent.keyDown(document.body,{key:'k',ctrlKey:true});const input=await screen.findByRole('combobox');fireEvent.change(input,{target:{value:'from:alice subject:invoice'}});fireEvent.keyDown(input,{key:'Enter'});await waitFor(()=>expect(state.query).toHaveBeenCalledWith('from:alice subject:invoice'));expect(state.run).not.toHaveBeenCalled();
});
it('does not execute a command captured for a different account',async()=>{
 const {rerender}=render(<App/>);fireEvent.keyDown(document.body,{key:'k',ctrlKey:true});const input=await screen.findByRole('combobox');fireEvent.change(input,{target:{value:'New message'}});act(()=>{state.owner='b';rerender(<App/>);});fireEvent.keyDown(input,{key:'Enter'});await new Promise(resolve=>setTimeout(resolve,10));expect(state.run).not.toHaveBeenCalled();
});
it('honours disabled shortcuts and navigation guards',async()=>{
 state.enabled=false;const {rerender}=render(<App/>);fireEvent.keyDown(document.body,{key:'k',ctrlKey:true});expect(screen.queryByRole('dialog')).toBeNull();state.enabled=true;rerender(<App/>);state.guard.mockRejectedValue(new Error('Save your settings first'));fireEvent.keyDown(document.body,{key:'k',ctrlKey:true});const input=await screen.findByRole('combobox');fireEvent.change(input,{target:{value:'Open Settings'}});fireEvent.keyDown(input,{key:'Enter'});await waitFor(()=>expect(state.guard).toHaveBeenCalledOnce());expect(state.push).not.toHaveBeenCalled();
});
