import yauzl from 'yauzl';
import {SaxesParser} from 'saxes';
import {fail} from './common.js';
function invalid(message){return Object.assign(new Error(message),{status:400});}
export async function extractWordText(bytes){
 await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
  if(error)return reject(invalid('เปิดไฟล์ Word ไม่ได้'));
  let total=0,count=0,hasDocument=false;
  const stop=message=>{zip.close();reject(invalid(message));};
  zip.on('error',()=>stop('ไฟล์ Word เสียหาย'));
  zip.on('entry',entry=>{
   total+=entry.uncompressedSize;count++;
   if(total>40*1024*1024||count>1000||entry.generalPurposeBitFlag&1)return stop('ไฟล์ Word มีข้อมูลมากเกินไป หรือมีการเข้ารหัส');
   if(entry.fileName==='word/document.xml'){hasDocument=true;if(entry.uncompressedSize>8*1024*1024)return stop('เนื้อหาไฟล์ Word ยาวเกินขนาดที่รองรับ');}
   zip.readEntry();
  });
  zip.on('end',()=>hasDocument?resolve():reject(invalid('ไฟล์นี้ไม่ใช่เอกสาร Word .docx')));zip.readEntry();
 }));
 const xml=await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
  if(error)return reject(invalid('เปิดไฟล์ Word ไม่ได้'));
  zip.on('error',()=>{zip.close();reject(invalid('ไฟล์ Word เสียหาย'));});
  zip.on('entry',entry=>{
   if(entry.fileName!=='word/document.xml'){zip.readEntry();return;}
   zip.openReadStream(entry,(error,stream)=>{
    if(error){zip.close();reject(invalid('อ่านเนื้อหาไฟล์ Word ไม่ได้'));return;}
    let size=0;const parts=[];
    stream.on('data',part=>{size+=part.length;if(size>8*1024*1024){stream.destroy();zip.close();reject(invalid('เนื้อหา Word ยาวเกินขนาดที่รองรับ'));}else parts.push(part);});
    stream.on('error',()=>{zip.close();reject(invalid('ไฟล์ Word เสียหาย'));});
    stream.on('end',()=>{zip.close();resolve(Buffer.concat(parts).toString('utf8'));});
   });
  });zip.readEntry();
 }));
 const parser=new SaxesParser({xmlns:true});let insideText=false,output='';
 parser.on('doctype',()=>fail(400,'ไฟล์ Word มี XML ที่ไม่รองรับ'));
 parser.on('opentag',node=>{if(node.local==='t')insideText=true;if(['br','cr'].includes(node.local))output+='\n';if(node.local==='tab')output+='\t';});
 parser.on('text',value=>{if(insideText){output+=value;if(output.length>500000)fail(400,'ข้อความในเอกสาร Word ยาวเกินขนาดที่รองรับ');}});
 parser.on('closetag',node=>{if(node.local==='t')insideText=false;if(['p','tr'].includes(node.local))output+='\n';});
 try{parser.write(xml).close();}catch(error){if(error.status)throw error;fail(400,'อ่านเนื้อหาไฟล์ Word ไม่ได้');}
 return output.trim();
}
