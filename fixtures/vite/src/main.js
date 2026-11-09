import { calculateInvoice, greet } from './math.js';

globalThis.__AIOB_TEST__ = {
    invoice: calculateInvoice([10, 20, 30], 0.1),
    greeting: greet('Vite'),
    dataset: [1, 2, 3].map(n => n * n)
};

globalThis.__AIOB_LAZY__ = async () => {
    const module = await import('./lazy.js');
    return module.dynamicResult(7);
};
