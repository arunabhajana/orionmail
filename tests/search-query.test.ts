import {expect,it} from 'vitest';
import {buildSearchQuery,readSearchFields,searchTokens} from '@/lib/search-query';
it('round trips phrases, dates and exclusions without dropping unsupported form terms',()=>{
 const query='forecast -from:spam@example.com subject:"quarterly report" tag:"My work" after:2026-01-01 is:unread has:attachment in:all';
 const fields=readSearchFields(query);expect(fields.subject).toBe('quarterly report');expect(fields.tag).toBe('My work');expect(fields.attachments).toBe(true);
 const rebuilt=buildSearchQuery(fields);expect(rebuilt).toContain('-from:spam@example.com');expect(readSearchFields(rebuilt)).toEqual(fields);expect(searchTokens(rebuilt)).toContain('tag:"My work"');
});
it('preserves repeated filters and rejects invalid date ranges',()=>{
 const fields=readSearchFields('from:alice from:bob filename:pdf');expect(buildSearchQuery(fields)).toContain('from:bob');expect(fields.text).toContain('filename:pdf');
 expect(()=>buildSearchQuery({...fields,after:'2026-02-30'})).toThrow(/valid dates/);expect(()=>buildSearchQuery({...fields,after:'2026-11-04',before:'2026-11-03'})).toThrow(/later/);
});
