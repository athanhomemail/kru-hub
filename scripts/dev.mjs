import {spawn} from 'node:child_process';
const npm=process.platform==='win32'?'npm.cmd':'npm';
const children=['backend','frontend'].map(workspace=>spawn(npm,['run','dev','--workspace',workspace],{stdio:'inherit'}));
let stopping=false;
function stop(signal='SIGTERM'){if(stopping)return;stopping=true;for(const child of children)child.kill(signal);}
for(const child of children){child.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});child.on('exit',code=>{if(!stopping){stop();process.exitCode=code||0;}});}
process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop());
