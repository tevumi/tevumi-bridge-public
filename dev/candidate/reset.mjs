// Explicit reset for local simulated assets only; preserve the old evidence directory.
import {archiveCandidate} from './persistent.mjs';
await archiveCandidate();
console.log('旧本地环境已归档。请重新启动 npm run dev:candidate 创建新模拟环境。');
