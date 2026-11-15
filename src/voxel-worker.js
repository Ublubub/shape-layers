import { voxelize } from './voxelizer.js';

self.onmessage = (e) => {
  const { id, job } = e.data;
  try {
    const result = voxelize(job, (p) => self.postMessage({ id, progress: p }));
    self.postMessage({ id, result }, [result.kind.buffer, result.mat.buffer, result.meta.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
