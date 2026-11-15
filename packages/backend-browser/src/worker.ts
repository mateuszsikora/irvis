import { installWorker, type WorkerScope } from './worker-runtime.ts';
installWorker(globalThis as unknown as WorkerScope);
