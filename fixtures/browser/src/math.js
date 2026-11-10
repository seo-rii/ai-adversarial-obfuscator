export function invoice(prices, rate) {
    return Number((prices.reduce((sum, price) => sum + price, 0) * (1 + rate)).toFixed(2));
}

export function total(values) {
    return values.reduce((sum, value) => sum + value, 0);
}
