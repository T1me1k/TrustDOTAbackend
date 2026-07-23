import type { MatchmakingWorker } from './matcher.js';export async function stopWorker(worker:MatchmakingWorker){await worker.stop()}
