export function snoozeKey(email:{threadId?:string;messageId?:string;folder:string;uid:number;uidValidity?:number}):string {
 const root=email.threadId||email.messageId;return root?JSON.stringify(['thread',root]):JSON.stringify(['source',email.folder,email.uid,email.uidValidity??0]);
}
export function snoozePresets(now=new Date()) {
 const later=new Date(now.getTime()+3*3600000);const tomorrow=new Date(now);tomorrow.setDate(now.getDate()+1);tomorrow.setHours(9,0,0,0);
 const week=new Date(now);week.setDate(now.getDate()+((8-now.getDay())%7||7));week.setHours(9,0,0,0);
 return [{label:'In 3 hours',date:later},{label:'Tomorrow',date:tomorrow},{label:'Next week',date:week}];
}
