import {useState} from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it} from 'vitest';
import {SearchBar} from '@/components/inbox/EmailListHeader';
function Search(){const [query,setQuery]=useState('');return <SearchBar value={query} onChange={setQuery} onClear={()=>setQuery('')}/>;}
it('builds filters through the custom panel and removes individual chips',async()=>{
 render(<Search/>);fireEvent.click(screen.getByRole('button',{name:'Advanced search'}));
 fireEvent.change(screen.getByLabelText('From',{exact:true}),{target:{value:'alice@example.com'}});fireEvent.change(screen.getByLabelText('Subject',{exact:true}),{target:{value:'quarterly report'}});
 fireEvent.click(screen.getByRole('checkbox',{name:'Has attachments'}));fireEvent.click(screen.getByRole('button',{name:'Search mail'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(screen.getByRole('searchbox')).toHaveValue('from:alice@example.com subject:"quarterly report" has:attachment');
 fireEvent.click(screen.getByRole('button',{name:'Remove filter has:attachment'}));expect(screen.getByRole('searchbox')).not.toHaveValue(expect.stringContaining('has:attachment'));
});
it('keeps invalid date input in the panel and explains how to fix it',()=>{
 render(<Search/>);fireEvent.click(screen.getByRole('button',{name:'Advanced search'}));fireEvent.change(screen.getByLabelText('From date (UTC)'),{target:{value:'2026-99-99'}});fireEvent.click(screen.getByRole('button',{name:'Search mail'}));expect(screen.getByRole('alert')).toHaveTextContent('valid dates');expect(screen.getByRole('dialog')).toBeInTheDocument();
});
