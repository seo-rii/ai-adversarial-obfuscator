import { invoice } from './math.js';

const button = document.querySelector('#run');
const output = document.querySelector('#result');

function workerResult() {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
        worker.addEventListener('message', event => {
            worker.terminate();
            resolve(event.data);
        }, { once: true });
        worker.addEventListener('error', event => {
            worker.terminate();
            reject(new Error(event.message));
        }, { once: true });
        worker.postMessage([5, 10, 15]);
    });
}

button.addEventListener('click', async () => {
    button.disabled = true;
    try {
        const lazy = await import('./lazy.js');
        const result = {
            invoice: invoice([10, 20, 30], 0.1),
            lazy: lazy.lazyResult(7),
            worker: await workerResult()
        };
        output.textContent = JSON.stringify(result);
        output.dataset.state = 'ready';
    } catch (error) {
        output.textContent = error.message;
        output.dataset.state = 'error';
        throw error;
    }
});

button.dataset.ready = 'true';
