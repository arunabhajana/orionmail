import type {LucideIcon} from 'lucide-react';
export type MailCommand={id:string;label:string;group:string;keywords?:string;shortcut?:string;icon:LucideIcon;run:()=>void|Promise<unknown>};
export function rankCommands(commands:MailCommand[],query:string){
 const words=query.replace(/^>/,'').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 return commands.map((command,index)=>({command,index,score:words.reduce((score,word)=>score+(command.label.toLocaleLowerCase().startsWith(word)?6:command.label.toLocaleLowerCase().includes(word)?3:1),0)}))
  .filter(({command})=>words.every(word=>(command.label+' '+command.group+' '+(command.keywords||'')).toLocaleLowerCase().includes(word)))
  .sort((a,b)=>b.score-a.score||a.index-b.index).map(row=>row.command).slice(0,40);
}
