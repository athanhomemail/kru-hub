import axios from 'axios';
export const api=axios.create({baseURL:'/api',withCredentials:true,headers:{'X-KruHub':'1'}});
api.interceptors.response.use(r=>r,err=>{if(err.response?.status===401)window.dispatchEvent(new Event('kruhub:session-expired'));err.message=err.response?.data?.error||'เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่';return Promise.reject(err);});
export const schoolApi=(schoolId,path)=>`/schools/${schoolId}${path}`;
export const dateOnly=value=>typeof value==='string'?value.slice(0,10):'';
export const thaiDate=value=>value?new Date(value).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'}):'—';
export const days=['','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'];
export function download(url){window.open(`/api${url}`,'_blank','noopener');}
