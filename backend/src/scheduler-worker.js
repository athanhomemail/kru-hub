import {randomBytes} from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { solve } from './scheduler.js';
parentPort.postMessage({kind:'result',result:solve(workerData.state,workerData.roomIds,6000,{seed:randomBytes(4).readUInt32LE(0)})});
