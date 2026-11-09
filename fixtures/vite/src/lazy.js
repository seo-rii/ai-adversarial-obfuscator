export function dynamicResult(n) {
    let total = 0;
    for (let i = 1; i <= n; i++) total += i * i;
    return total;
}
