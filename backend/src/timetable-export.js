import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';
import {fail,id} from './common.js';

const days=['','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'];
const statusNames={draft:'ฉบับร่าง',published:'เผยแพร่แล้ว',archived:'ประวัติ'};
const palette=['FCE7EF','EDE9FE','DBEAFE','D1FAE5','FEF3C7','FFEDD5','CFFAFE'];
const time=slot=>`${slot.starts_at.slice(0,5)}-${slot.ends_at.slice(0,5)}`;
const same=(a,b)=>Number(a)===Number(b);

// One model feeds both formats so room/teacher filtering and cell contents agree.
export function exportModel(state,data,school,query={}){
 const view=query.view||'room';if(!['room','teacher'].includes(view))fail(400,'รูปแบบตารางไม่ถูกต้อง');
 if((view==='room'&&query.teacher_id)||(view==='teacher'&&(query.room_id||query.grade_id)))fail(400,'ตัวกรองไม่ตรงกับประเภทตาราง');
 let entities;
 if(view==='room'){
  entities=[...state.classrooms];
  if(query.grade_id)entities=entities.filter(r=>same(r.grade_level_id,id(query.grade_id)));
  if(query.room_id)entities=entities.filter(r=>same(r.id,id(query.room_id)));
  entities.sort((a,b)=>Number(data.grade_levels.find(g=>same(g.id,a.grade_level_id))?.sort_order||0)-Number(data.grade_levels.find(g=>same(g.id,b.grade_level_id))?.sort_order||0)||a.name.localeCompare(b.name,'th',{numeric:true}));
 }else{
  entities=data.staff.filter(t=>t.is_teacher||state.entries.some(e=>same(e.teacher_id,t.id)));
  if(query.teacher_id)entities=entities.filter(t=>same(t.id,id(query.teacher_id)));
  entities.sort((a,b)=>a.display_name.localeCompare(b.display_name,'th'));
 }
 if(!entities.length)fail(404,view==='room'?'ไม่พบห้องเรียนในตารางฉบับนี้':'ไม่พบครูในโรงเรียน');
 const term=data.terms.find(t=>same(t.id,state.version.term_id));
 const year=data.academic_years.find(y=>same(y.id,term?.academic_year_id));
 const periods=[...new Set(state.slots.map(s=>Number(s.period_number)))].sort((a,b)=>a-b);
 if(!periods.length)fail(400,'ยังไม่ได้กำหนดเวลาเรียนสำหรับภาคเรียนนี้');
 const weekdays=[...new Set(state.slots.map(s=>Number(s.weekday)))].sort((a,b)=>a-b);
 const reqs=new Map(state.requirements.map(r=>[Number(r.id),r]));
 const subjects=new Map(data.subjects.map((s,i)=>[Number(s.id),{...s,color:palette[i%palette.length]}]));
 const teachers=new Map(data.staff.map(t=>[Number(t.id),t.display_name]));
 const rooms=new Map(state.classrooms.map(r=>[Number(r.id),r.name]));
 const sheets=entities.map(entity=>{
  const entries=state.entries.filter(e=>same(view==='room'?e.classroom_id:e.teacher_id,entity.id));
  const bySlot=new Map(entries.map(e=>[Number(e.slot_id),e]));
  return {id:entity.id,name:view==='room'?entity.name:entity.display_name,title:`${view==='room'?'ตารางเรียน':'ตารางสอน'} · ${view==='room'?entity.name:entity.display_name}`,count:entries.length,rows:weekdays.map(day=>({day,label:days[day],cells:periods.map(period=>{
   const slot=state.slots.find(s=>same(s.weekday,day)&&same(s.period_number,period));
   if(!slot)return {text:'ไม่มีคาบเรียน',color:'F3F4F6',available:false};
   const entry=bySlot.get(Number(slot.id));
   const available=view==='teacher'||state.classroomSlots.some(s=>same(s.classroom_id,entity.id)&&same(s.slot_id,slot.id));
   if(!entry)return {text:available?'ว่าง':'ไม่มีคาบเรียน',time:time(slot),color:available?'FFFFFF':'F3F4F6',available};
   const req=reqs.get(Number(entry.requirement_id)),subject=subjects.get(Number(req?.subject_id));
   return {text:`${req?.subject_name||subject?.name||'รายวิชา'}\n${view==='room'?teachers.get(Number(entry.teacher_id))||'':`ห้อง ${rooms.get(Number(entry.classroom_id))||''}`}`,time:time(slot),color:subject?.color||palette[0],available:true};
  })}))};
 });
 return {view,school:school.name,version:state.version.id,revision:state.version.revision,status:statusNames[state.version.status]||state.version.status,term:`ปีการศึกษา ${year?.buddhist_year||''} · ภาคเรียนที่ ${term?.term_number||''}`,periods,sheets};
}

function sheetName(value,used){
 const base=value.replace(/[\\/*?:\[\]\x00-\x1f]/g,' ').replace(/^'+|'+$/g,'').trim().slice(0,31)||'ตาราง';
 let name=base,n=1;while(used.has(name.toLocaleLowerCase())){const suffix=` (${++n})`;name=base.slice(0,31-suffix.length)+suffix;}used.add(name.toLocaleLowerCase());return name;
}

export async function excelExport(model){
 const workbook=new ExcelJS.Workbook();workbook.creator='Kru-Hub';workbook.title=`${model.view==='room'?'ตารางเรียน':'ตารางสอน'} - ${model.school}`;
 const names=new Set();
 for(const item of model.sheets){
  const sheet=workbook.addWorksheet(sheetName(item.name,names),{views:[{state:'frozen',xSplit:1,ySplit:5,showGridLines:false}],pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:Math.ceil(model.periods.length/6),fitToHeight:1,margins:{left:.25,right:.25,top:.35,bottom:.35,header:.15,footer:.15}}});
  const width=model.periods.length+1;
  sheet.columns=[{width:16},...model.periods.map(()=>({width:25}))];
  const heading=(row,text,size,color)=>{sheet.mergeCells(row,1,row,width);const c=sheet.getCell(row,1);c.value=text;c.font={name:'Sarabun',size,bold:true,color:{argb:color}};c.alignment={vertical:'middle',wrapText:true};sheet.getRow(row).height=Math.max(size*2,Math.ceil(text.length/(width*12))*size*1.5);};
  heading(1,model.school,16,'FF6D284A');heading(2,item.title,20,'FF292333');heading(3,`${model.term} · ฉบับ #${model.version} · ${model.status}`,11,'FF6B6472');heading(4,`รวม ${item.count} คาบต่อสัปดาห์`,11,'FF6B6472');
  sheet.getRow(5).values=['วัน / คาบ',...model.periods.map(p=>`คาบ ${p}`)];sheet.getRow(5).height=30;
  for(let col=1;col<=width;col++){const cell=sheet.getCell(5,col);cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF6D284A'}};cell.font={name:'Sarabun',size:12,bold:true,color:{argb:'FFFFFFFF'}};cell.alignment={vertical:'middle',horizontal:'center'};}
  item.rows.forEach((row,i)=>{
   const number=i+6;sheet.getRow(number).values=[row.label,...row.cells.map(c=>[c.time,c.text].filter(Boolean).join('\n'))];
   sheet.getRow(number).height=Math.min(409,Math.max(76,...row.cells.map(c=>((c.text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/22)),0))+2)*18)));
   for(let col=1;col<=width;col++){
    const cell=sheet.getCell(number,col);cell.font={name:'Sarabun',size:11,bold:col===1,color:{argb:col===1?'FF6D284A':'FF292333'}};
    cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:`FF${col===1?'F8EAF0':row.cells[col-2].color}`}};
    cell.border=Object.fromEntries(['top','bottom','left','right'].map(edge=>[edge,{style:'thin',color:{argb:'FFE4DDE3'}}]));
   }
  });
  sheet.pageSetup.printArea=`A1:${sheet.getColumn(width).letter}${item.rows.length+5}`;sheet.pageSetup.printTitlesRow='1:5';sheet.headerFooter.oddFooter='&LKru-Hub&R&P / &N';
 }
 return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function pdfExport(model){
 const doc=new PDFDocument({autoFirstPage:false,bufferPages:true,info:{Title:`${model.view==='room'?'ตารางเรียน':'ตารางสอน'} - ${model.school}`,Author:'Kru-Hub'}});
 doc.registerFont('Thai',fileURLToPath(new URL('../assets/fonts/Sarabun-Regular.ttf',import.meta.url)));
 doc.registerFont('ThaiBold',fileURLToPath(new URL('../assets/fonts/Sarabun-Bold.ttf',import.meta.url)));
 const chunks=[];const result=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const margin=30,dayWidth=65;
 for(const item of model.sheets){
  // Wide schedules continue across pages instead of shrinking Thai text.
  for(let offset=0;offset<model.periods.length;offset+=6){
   const periods=model.periods.slice(offset,offset+6);let y,width,colWidth;
   const newPage=()=>{
    doc.addPage({size:'A4',layout:'landscape',margin:0});width=doc.page.width-margin*2;colWidth=(width-dayWidth)/periods.length;
    doc.rect(0,0,doc.page.width,8).fill('#6D284A');
    y=24;doc.font('ThaiBold').fontSize(13).fillColor('#6D284A');doc.text(model.school,margin,y,{width});y+=doc.heightOfString(model.school,{width})+4;
    doc.fontSize(20).fillColor('#292333');doc.text(item.title,margin,y,{width});y+=doc.heightOfString(item.title,{width})+4;
    doc.font('Thai').fontSize(10).fillColor('#6B6472');const subtitle=`${model.term} · ฉบับ #${model.version} · ${model.status} · รวม ${item.count} คาบ/สัปดาห์`;
    doc.text(subtitle,margin,y,{width});y+=doc.heightOfString(subtitle,{width})+14;
    if(model.periods.length>6){doc.text(`คาบ ${periods[0]}-${periods.at(-1)}`,margin,y,{width});y+=20;}
    const header=(text,x,w)=>{doc.rect(x,y,w,32).fill('#6D284A');doc.font('ThaiBold').fontSize(11).fillColor('#FFFFFF').text(text,x+5,y+6,{width:w-10,align:'center'});};
    header('วัน / คาบ',margin,dayWidth);periods.forEach((p,i)=>header(`คาบ ${p}`,margin+dayWidth+i*colWidth,colWidth));y+=32;
   };
   newPage();
   for(const row of item.rows){
    const cells=row.cells.slice(offset,offset+6);
    doc.font('Thai').fontSize(10);
    const height=Math.max(58,...cells.map(c=>doc.heightOfString([c.time,c.text].filter(Boolean).join('\n'),{width:colWidth-16,align:'center'})+20));
    if(y+height>doc.page.height-40)newPage();
    const drawCell=(text,x,w,color,bold=false)=>{
     doc.rect(x,y,w,height).fillAndStroke(`#${color}`,'#E4DDE3');doc.font(bold?'ThaiBold':'Thai').fontSize(bold?11:10).fillColor(bold?'#6D284A':'#292333');
     const textHeight=doc.heightOfString(text,{width:w-16,align:'center'});doc.text(text,x+8,y+(height-textHeight)/2,{width:w-16,align:'center'});
    };
    drawCell(row.label,margin,dayWidth,'F8EAF0',true);cells.forEach((c,i)=>drawCell([c.time,c.text].filter(Boolean).join('\n'),margin+dayWidth+i*colWidth,colWidth,c.color));y+=height;
   }
  }
 }
 const range=doc.bufferedPageRange();
 for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.font('Thai').fontSize(8).fillColor('#817786').text(`Kru-Hub · ${i+1} / ${range.count}`,margin,doc.page.height-25,{width:doc.page.width-margin*2,align:'right'});}
 doc.end();return result;
}
