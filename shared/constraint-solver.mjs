// Indexed occupancy and bounded backtracking; each run explores a fresh seeded order.
export function solveSchedule(state,roomIds,limitMs=6000,options={}){
 const started=Date.now(),deadline=started+Math.max(0,limitMs),targets=new Set(roomIds.map(Number));
 const slots=[...state.slots].sort((a,b)=>a.weekday-b.weekday||String(a.starts_at).localeCompare(String(b.starts_at))||Number(a.id)-Number(b.id));
 const index=new Map(slots.map((s,i)=>[Number(s.id),i]));
 const time=t=>String(t).split(':').reduce((v,n)=>v*60+Number(n),0)*(String(t).split(':').length===2?60:1);
 const conflicts=slots.map(a=>slots.flatMap((b,i)=>Number(a.weekday)===Number(b.weekday)&&time(a.starts_at)<time(b.ends_at)&&time(b.starts_at)<time(a.ends_at)?[i]:[]));
 const roomBusy=new Map(),teacherBusy=new Map();
 const occupancy=(map,id)=>{id=Number(id);if(!map.has(id))map.set(id,new Int32Array(slots.length));return map.get(id);};
 const groups=new Map(),allReq=new Map();
 for(const r of state.requirements){const key=`${r.classroom_id}:${r.subject_id??`r${r.id}`}`;if(!groups.has(key))groups.set(key,{limit:0,days:new Int32Array(8)});const group=groups.get(key);group.limit=Math.max(group.limit,Number(r.daily_limit));allReq.set(Number(r.id),{...r,group,count:0,last:-1});}
 const allowed=new Map();for(const c of state.classroomSlots){const key=Number(c.classroom_id);if(!allowed.has(key))allowed.set(key,new Set());allowed.get(key).add(Number(c.slot_id));}
 const unavailable=new Map();for(const u of state.unavailable){const si=index.get(Number(u.slot_id));if(si===undefined)continue;const busy=occupancy(unavailable,u.teacher_id);for(const i of conflicts[si])busy[i]++;}
 const reqs=[...allReq.values()].filter(r=>targets.has(Number(r.classroom_id))).map(r=>({...r,room:occupancy(roomBusy,r.classroom_id),teacher:occupancy(teacherBusy,r.teacher_id),domain:slots.flatMap((s,i)=>allowed.get(Number(r.classroom_id))?.has(Number(s.id))&&!unavailable.get(Number(r.teacher_id))?.[i]?[i]:[])}));
 const reqById=new Map(reqs.map(r=>[Number(r.id),r]));
 const fixed=state.entries.filter(e=>!targets.has(Number(e.classroom_id))||e.source==='manual'||e.locked);
 const entries=[...fixed],stack=[];
 function occupy(entry,delta){const si=index.get(Number(entry.slot_id));if(si===undefined)return;for(const i of conflicts[si]){occupancy(roomBusy,entry.classroom_id)[i]+=delta;occupancy(teacherBusy,entry.teacher_id)[i]+=delta;}const r=allReq.get(Number(entry.requirement_id));if(r)r.group.days[Number(slots[si].weekday)]+=delta;const target=reqById.get(Number(entry.requirement_id));if(target)target.count+=delta;}
 for(const entry of fixed)occupy(entry,1);
 const candidates=r=>r.domain.filter(i=>i>r.last&&!r.room[i]&&!r.teacher[i]&&r.group.days[Number(slots[i].weekday)]<r.group.limit);
 function push(r,i){const entry={classroom_id:r.classroom_id,requirement_id:r.id,teacher_id:r.teacher_id,slot_id:slots[i].id,source:'auto',locked:0};entries.push(entry);stack.push({r,entry,last:r.last});occupy(entry,1);}
 function pop(){const {r,entry,last}=stack.pop();occupy(entry,-1);r.last=last;entries.pop();}
 let best=[...fixed],nodes=0,attempts=0,stopped=false;
 const previous=new Set(state.entries.filter(e=>targets.has(Number(e.classroom_id))&&e.source==='auto'&&!e.locked).map(e=>`${e.requirement_id}:${e.slot_id}`));
 const difference=()=>entries.filter(e=>e.source==='auto'&&!e.locked&&targets.has(Number(e.classroom_id))&&!previous.has(`${e.requirement_id}:${e.slot_id}`)).length;
 let searching=false,baselineComplete=false,bestDifference=0;

 const goal=reqs.reduce((n,r)=>n+Math.max(0,Number(r.periods_per_week)-r.count),0)+fixed.length;
 const keep=()=>{const changed=difference();if(entries.length>best.length||entries.length===best.length&&changed>bestDifference){best=[...entries];bestDifference=changed;}return entries.length>=goal&&(!searching||!baselineComplete||changed>0);};
 // Preserve any still-valid existing Auto entries as a lower bound, without keeping IDs that the API deletes.
 for(const entry of state.entries.filter(e=>targets.has(Number(e.classroom_id))&&e.source==='auto'&&!e.locked)){const r=reqById.get(Number(entry.requirement_id)),i=index.get(Number(entry.slot_id));if(r&&i!==undefined&&r.count<r.periods_per_week&&candidates(r).includes(i)){push(r,i);keep();}}
 while(stack.length)pop();
 baselineComplete=best.length>=goal;searching=true;
 const runSeed=(options.seed??Math.floor(Math.random()*0x100000000))>>>0;
 let seed=runSeed||0x9e3779b9;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
 const greedyEnd=started+Math.min(1000,Math.max(0,limitMs*.25));
 let found=goal===fixed.length;
 while(!found&&attempts<(options.greedyAttempts??250)&&Date.now()<greedyEnd){
  attempts++;
  while(Date.now()<greedyEnd){
   const options=reqs.filter(r=>r.count<r.periods_per_week).map(r=>({r,remaining:r.periods_per_week-r.count,slots:candidates(r),tie:random()})).filter(o=>o.slots.length);
   if(!options.length)break;
   options.sort((a,b)=>a.slots.length/a.remaining-b.slots.length/b.remaining||a.tie-b.tie);
   const o=options[0];push(o.r,o.slots[Math.floor(random()*o.slots.length)]);if(keep()){found=true;break;}
  }
  while(stack.length)pop();
 }
 function search(){
  if(keep())return true;
  if(++nodes>250000||Date.now()>=deadline){stopped=true;return false;}
  let chosen=null;
  for(const r of reqs){const remaining=r.periods_per_week-r.count;if(remaining<=0)continue;const available=candidates(r);if(available.length<remaining)return false;
   // Account for shared subject/day caps as well as the number of free cells.
   const perDay=new Map();for(const i of available){const day=Number(slots[i].weekday);perDay.set(day,(perDay.get(day)||0)+1);}
   let capacity=0;for(const [day,n] of perDay)capacity+=Math.min(n,r.group.limit-r.group.days[day]);if(capacity<remaining)return false;
   const slack=available.length/remaining;if(!chosen||slack<chosen.slack)chosen={r,available,slack};
  }
  if(!chosen)return false;
  // Prefer values that remove the fewest other legal placements (least constraining value).
  const {r,available}=chosen;
  const cost=i=>{let value=0;for(const other of reqs){if(other===r||other.count>=other.periods_per_week)continue;for(const j of candidates(other)){if((other.room===r.room||other.teacher===r.teacher)&&conflicts[i].includes(j))value++;else if(other.group===r.group&&slots[j].weekday===slots[i].weekday&&r.group.days[slots[i].weekday]+1>=r.group.limit)value++;}}return value;};
  const ordered=available.map(i=>({i,cost:cost(i),old:previous.has(`${r.id}:${slots[i].id}`)?1:0,tie:random()})).sort((a,b)=>a.cost-b.cost||a.old-b.old||a.tie-b.tie);
  for(const {i} of ordered){push(r,i);r.last=i;if(search())return true;pop();if(stopped)return false;}
  return false;
 }
 if(!found&&Date.now()<deadline)search();
 const remaining=reqs.map(r=>({...state.requirements.find(x=>Number(x.id)===Number(r.id)),remaining:Number(r.periods_per_week)-best.filter(e=>Number(e.requirement_id)===Number(r.id)).length})).filter(r=>r.remaining>0);
 return {entries:best,remaining,complete:!remaining.length,search:{algorithm:'indexed-search-v2',seed:runSeed,kept_previous:baselineComplete&&bestDifference===0,movable_lessons:goal-fixed.length,attempts,nodes,elapsed_ms:Date.now()-started,budget_exhausted:stopped||Date.now()>=deadline}};
}
