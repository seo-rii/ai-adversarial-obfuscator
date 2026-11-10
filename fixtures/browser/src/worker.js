import { total } from './math.js';

self.addEventListener('message', event => {
    self.postMessage({ total: total(event.data), runtime: 'worker' });
});
