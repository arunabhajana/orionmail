import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {Inbox} from 'lucide-react';
vi.mock('next/navigation',()=>({usePathname:()=>'/inbox'}));
import {TagItem,NavItem} from '@/components/sidebar/SidebarNavItem';
import {ComposeSenderRow} from '@/components/ComposeSenderRow';
import type {Tag} from '@/lib/types';
const tag={id:'work',name:'Work',tag_type:'user'} as Tag;
it('opens functional tag actions on right click without navigating',()=>{
 const open=vi.fn(),edit=vi.fn(),remove=vi.fn();render(<TagItem tag={tag} onClick={open} onEdit={edit} onDelete={remove}/>);
 fireEvent.contextMenu(screen.getByRole('button',{name:'Work'}),{clientX:80,clientY:90});expect(open).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('menuitem',{name:'Edit name & colour'}));expect(edit).toHaveBeenCalledWith(tag);expect(screen.queryByRole('menu')).toBeNull();
 fireEvent.contextMenu(screen.getByRole('button',{name:'Work'}));fireEvent.click(screen.getByRole('menuitem',{name:'Delete tag'}));expect(remove).toHaveBeenCalledWith(tag);
});
it('offers keyboard context actions including subtree collapse',()=>{
 const collapse=vi.fn();render(<TagItem tag={tag} onClick={()=>{}} hasChildren isCollapsed={false} onToggleCollapse={collapse}/>);
 fireEvent.keyDown(screen.getByRole('button',{name:'Work'}),{key:'F10',shiftKey:true});fireEvent.click(screen.getByRole('menuitem',{name:'Collapse subtags'}));expect(collapse).toHaveBeenCalledOnce();
});
it('shows custom folder tooltips on focus without native titles',async()=>{
 render(<NavItem id="inbox" label="Inbox" icon={Inbox}/>);const button=screen.getByRole('button',{name:'Inbox'});
 expect(button).not.toHaveAttribute('title');fireEvent.focus(button);await waitFor(()=>expect(screen.getByRole('tooltip')).toHaveTextContent('Inbox'));fireEvent.blur(button);expect(screen.queryByRole('tooltip')).toBeNull();
});
it('uses plain sender text for a single account and locks replies with multiple accounts',()=>{
 const user={id:'a',email:'a@example.com'},other={id:'b',email:'b@example.com'};const onChange=vi.fn();
 const {rerender}=render(<ComposeSenderRow user={user} accounts={[user]} disabled={false} reply={false} changing={false} onChange={onChange}/>);
 expect(screen.getByText(user.email)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'From account'})).toBeNull();
 rerender(<ComposeSenderRow user={user} accounts={[user,other]} disabled={false} reply={false} changing={false} onChange={onChange}/>);expect(screen.getByRole('button',{name:'From account'})).toBeEnabled();
 rerender(<ComposeSenderRow user={user} accounts={[user,other]} disabled={false} reply changing={false} onChange={onChange}/>);expect(screen.getByRole('button',{name:'From account'})).toBeDisabled();
});
