export function StorageUsage({headers,bodies,messages,formatBytes}:{headers:number;bodies:number;messages?:number;formatBytes:(bytes:number)=>string}){
 const total=headers+bodies;
 const segments=[{label:'Headers & previews',bytes:headers,color:'#3b82f6'},{label:'Message bodies',bytes:bodies,color:'#a78bfa'}];
 return <figure aria-label="Cached mail storage breakdown" className="px-5 pb-5 pt-3">
  <figcaption className="mb-3 flex flex-wrap items-end justify-between gap-x-5 gap-y-2">
   <div>{messages!==undefined?<><strong className="text-lg font-semibold tracking-tight tabular-nums">{messages.toLocaleString()}</strong><span className="ml-2 text-xs text-muted-foreground">cached messages</span></>:<span className="text-xs text-muted-foreground">Measured mail content</span>}</div>
   <div className="flex items-baseline gap-2"><span className="text-[11px] text-muted-foreground">Cached content</span><strong className="text-lg font-semibold tracking-tight tabular-nums">{formatBytes(total)}</strong></div>
  </figcaption>
  <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-foreground/5">{segments.map(item=>item.bytes>0&&<span key={item.label} style={{width:`${total?item.bytes/total*100:0}%`,backgroundColor:item.color}}/>)}</div>
  <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">{segments.map(item=><li key={item.label} className="flex items-center gap-2 text-xs"><span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{backgroundColor:item.color}}/><span className="text-muted-foreground">{item.label}</span><span className="font-medium tabular-nums">{formatBytes(item.bytes)}</span></li>)}</ul>
  {total===0&&<p className="mt-3 text-xs text-muted-foreground">No cached message content yet.</p>}
  <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/80">Estimates exclude database indexes, free space and saved attachment files.</p>
 </figure>;
}
