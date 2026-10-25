import { parentPort, workerData } from 'node:worker_threads';
import { solve } from './scheduler.js';
parentPort.postMessage({kind:'result',result:solve(workerData.state, workerData.roomIds)});
