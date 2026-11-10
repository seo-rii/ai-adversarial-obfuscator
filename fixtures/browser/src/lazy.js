export function lazyResult(value) {
    return { label: `Loaded ${value}`, squares: [1, 2, 3].map(item => item * item) };
}
