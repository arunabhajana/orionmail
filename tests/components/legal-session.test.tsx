import {render,screen,fireEvent} from '@testing-library/react';
import {useEffect,useState} from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
const route=vi.hoisted(()=>({path:'/settings'}));
vi.mock('next/navigation',()=>({usePathname:()=>route.path}));
import {PublicPageBoundary} from '@/components/PublicPageBoundary';
beforeEach(()=>{route.path='/settings';});
it('preserves connected accounts, selected account and provider lifetime across legal navigation',()=>{
 const mounted=vi.fn(),unmounted=vi.fn();
 function Session(){const [active,setActive]=useState('Account A');useEffect(()=>{mounted();return()=>unmounted();},[]);return <><p>Two connected accounts</p><button onClick={()=>setActive('Account B')}>{active}</button></>;}
 const tree=()=> <PublicPageBoundary desktop={<Session/>}><h1>Legal document</h1></PublicPageBoundary>;
 const {rerender}=render(tree());fireEvent.click(screen.getByText('Account A'));
 for(const path of ['/privacy','/terms','/license','/notices']){route.path=path;rerender(tree());expect(screen.getByRole('heading')).toHaveTextContent('Legal document');expect(unmounted).not.toHaveBeenCalled();}
 route.path='/settings';rerender(tree());expect(screen.getByRole('button',{name:'Account B'})).toBeInTheDocument();expect(screen.getByText('Two connected accounts')).toBeInTheDocument();expect(mounted).toHaveBeenCalledOnce();expect(unmounted).not.toHaveBeenCalled();
});
it('initializes desktop only when leaving a standalone public page, then retains it',()=>{
 route.path='/privacy';const started=vi.fn();function Desktop(){useEffect(()=>{started();},[]);return <p>Desktop</p>;}
 const tree=()=> <PublicPageBoundary desktop={<Desktop/>}><h1>Privacy Policy</h1></PublicPageBoundary>;
 const {rerender}=render(tree());expect(started).not.toHaveBeenCalled();route.path='/settings';rerender(tree());expect(started).toHaveBeenCalledOnce();route.path='/terms';rerender(tree());route.path='/settings';rerender(tree());expect(started).toHaveBeenCalledOnce();
});
