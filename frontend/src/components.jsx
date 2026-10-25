import {createPortal} from 'react-dom';
import React,{useEffect,useRef,useContext,createContext} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {X,LoaderCircle,ArrowUpRight,Sparkles,CalendarDays,FileText,GraduationCap,Layers3,BookOpen,Users,Clock3} from 'lucide-react';
export const NoticeContext=createContext(null);
export const icons={home:Layers3,timetable:CalendarDays,plans:FileText,school:GraduationCap,accounts:Users,media:BookOpen,users:Users,clock:Clock3};
export function Reveal({children,className='',delay=0}){const reduce=useReducedMotion();return <motion.div className={className} initial={reduce?false:{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{duration:.55,delay,ease:[.22,1,.36,1]}}>{children}</motion.div>;}
export function Button({children,icon:Icon,loading,variant='primary',className='',...props}){return <button className={`btn ${variant} ${className}`} disabled={loading||props.disabled} {...props}>{loading?<LoaderCircle size={17} className="spin"/>:Icon&&<Icon size={17}/>}<span>{children}</span></button>;}
export function Modal({title,children,onClose,wide=false}){
 const notice=useContext(NoticeContext);
 const ref=useRef();useEffect(()=>{const dialog=ref.current;dialog.showModal();const before=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog.close();document.body.style.overflow=before;};},[]);
 return createPortal(<dialog ref={ref} className={`modal ${wide?'wide':''}`} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="modal-head"><div><p className="overline">KRU-HUB WORKSPACE</p><h2>{title}</h2></div><button className="icon-btn" aria-label="ปิดหน้าต่าง" onClick={onClose}><X size={20}/></button></div><div className="modal-body">{notice&&<div role="status" className={`modal-notice ${notice.type}`}>{notice.message}</div>}{children}</div></dialog>,document.body);
}
export function Field({label,children}){return <label className="field"><span>{label}</span>{children}</label>;}
export function Empty({icon:Icon=Sparkles,title,description,children}){return <div className="empty"><div className="empty-icon"><Icon size={30}/></div><h3>{title}</h3><p>{description}</p>{children}</div>;}
export function PageHead({eyebrow,title,description,children}){return <Reveal className="page-heading"><div><p className="overline">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div><div className="head-actions">{children}</div></Reveal>;}
export function Orb({small=false}){return <div className={`orb-scene ${small?'small':''}`} aria-hidden="true"><div className="orbit orbit-a"/><div className="orbit orbit-b"/><div className="orbit orbit-c"/><div className="orb"><div className="orb-shine"/><div className="orb-lines"/><Sparkles className="orb-symbol"/></div><div className="floating-label label-a"><CalendarDays size={18}/><span>เวลาที่ลงตัว</span><i/></div><div className="floating-label label-b"><FileText size={18}/><span>ทุกแผน อยู่ใกล้มือ</span></div><div className="orb-dot dot-a"/><div className="orb-dot dot-b"/></div>;}
export function ToolCard({number,title,description,icon:Icon,color,onClick,meta}){return <button className={`tool-card ${color}`} onClick={onClick}><div className="tool-top"><span className="tool-number">{number}</span><ArrowUpRight size={20}/></div><div className="tool-icon"><Icon size={30}/></div><h3>{title}</h3><p>{description}</p><div className="tool-bottom"><span>{meta}</span><span className="round-arrow"><ArrowUpRight size={17}/></span></div></button>;}
