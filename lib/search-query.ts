export type SearchFields={text:string;from:string;to:string;subject:string;tag:string;after:string;before:string;status:string;scope:string;attachments:boolean};
export const emptySearchFields:SearchFields={text:'',from:'',to:'',subject:'',tag:'',after:'',before:'',status:'',scope:'',attachments:false};
export function searchTokens(query:string){return query.match(/-?(?:[a-z]+:)?"(?:\\.|[^"\\])*"|[^\s]+/giu)||[];}
const quote=(value:string)=>/^[^\s"\\]+$/u.test(value.trim())?value.trim():JSON.stringify(value.trim());
export function readSearchFields(query:string):SearchFields{
 const fields={...emptySearchFields};const text:string[]=[];const assigned=new Set<string>();
 for(const token of searchTokens(query)){
  const match=/^([a-z]+):(.*)$/iu.exec(token);if(!match||token.startsWith('-')){text.push(token);continue;}
  const key=match[1].toLowerCase();let value=match[2];try{if(value.startsWith('"'))value=JSON.parse(value);}catch{/* Preserve unfinished input in free text. */}
  if(assigned.has(key)){text.push(token);continue;}
  if(['from','to','subject','tag','after','before'].includes(key)){fields[key as 'from']=value;assigned.add(key);}
  else if(key==='is'&&['read','unread','starred'].includes(value)){fields.status=value;assigned.add(key);}
  else if(key==='in'&&['all','anywhere','inbox','sent','trash','starred'].includes(value)){fields.scope=value;assigned.add(key);}
  else if(key==='has'&&['attachment','attachments'].includes(value)){fields.attachments=true;assigned.add(key);}
  else text.push(token);
 }
 fields.text=text.join(' ');return fields;
}
export function buildSearchQuery(fields:SearchFields){
 const terms=[fields.text.trim()];
 for(const key of ['from','to','subject','tag']as const)if(fields[key].trim())terms.push(key+':'+quote(fields[key]));
 for(const key of ['after','before']as const)if(fields[key].trim()){
  const date=fields[key].trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Enter valid dates in YYYY-MM-DD format.');terms.push(key+':'+date);
 }
 if(fields.after&&fields.before&&fields.after>=fields.before)throw new Error('The before date must be later than the from date.');
 if(fields.status)terms.push('is:'+fields.status);if(fields.attachments)terms.push('has:attachment');if(fields.scope)terms.push('in:'+fields.scope);
 return terms.filter(Boolean).join(' ');
}
