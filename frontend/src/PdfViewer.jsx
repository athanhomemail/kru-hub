import React,{useEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {Button} from './components';
import {ChevronLeft,ChevronRight} from 'lucide-react';
GlobalWorkerOptions.workerSrc=workerUrl;
export default function PdfViewer({url,mime}){
 const word=mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 const [wordText,setWordText]=useState('');
 useEffect(()=>{if(!word)return;let active=true;setWordText('กำลังอ่านเอกสาร Word…');fetch(url,{credentials:'include'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(r=>{if(active)setWordText(r.text);}).catch(()=>{if(active)setWordText('เปิดเอกสารไม่สำเร็จ ลิงก์อาจหมดอายุแล้ว');});return()=>{active=false;};},[word,url]);
 const canvas=useRef();const [pdf,setPdf]=useState(null),[page,setPage]=useState(1),[error,setError]=useState('');
 useEffect(()=>{if(mime!=='application/pdf')return;let mounted=true;setPdf(null);setPage(1);setError('');const task=getDocument({url,withCredentials:true,isEvalSupported:false});task.promise.then(doc=>{if(mounted)setPdf(doc);}).catch(()=>{if(mounted)setError('เปิดไฟล์ PDF ไม่สำเร็จ กรุณาตรวจว่าไฟล์ถูกต้องและลิงก์ยังไม่หมดอายุ');});return()=>{mounted=false;task.destroy();};},[url,mime]);
 useEffect(()=>{if(!pdf)return;let render;let cancelled=false;pdf.getPage(page).then(p=>{if(cancelled)return;const viewport=p.getViewport({scale:1.4});const node=canvas.current;node.width=viewport.width;node.height=viewport.height;render=p.render({canvasContext:node.getContext('2d'),viewport});return render.promise;}).catch(e=>{if(e.name!=='RenderingCancelledException'&&!cancelled)setError('แสดงหน้านี้ไม่ได้');});return()=>{cancelled=true;render?.cancel();};},[pdf,page]);
 if(word)return <div className="word-preview"><span className="tag">WORD · แสดงข้อความสำหรับอ่าน</span><p className="form-note">รูปภาพ ตาราง และรูปแบบหน้าเอกสารให้ดูจากต้นฉบับที่ดาวน์โหลดโดยคนในโรงเรียน</p><pre>{wordText}</pre></div>;
 if(mime!=='application/pdf')return <img className="image-preview" src={url} alt="เอกสารแผนการสอน"/>;
 return <div className="pdf-viewer">{error?<p className="error-text">{error}</p>:<>{!pdf&&<p>กำลังเปิดเอกสาร…</p>}<canvas ref={canvas}/>{pdf&&<div className="pdf-controls"><Button variant="ghost" icon={ChevronLeft} disabled={page<=1} onClick={()=>setPage(p=>p-1)}>ก่อนหน้า</Button><span>{page} / {pdf.numPages}</span><Button variant="ghost" icon={ChevronRight} disabled={page>=pdf.numPages} onClick={()=>setPage(p=>p+1)}>ถัดไป</Button></div>}</>}</div>;
}
