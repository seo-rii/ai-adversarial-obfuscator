export function calculateInvoice(prices, vatRate) {
    let subtotal = 0;
    for (const price of prices) {
        if (price > 0) subtotal += price;
    }
    return Number((subtotal * (1 + vatRate)).toFixed(2));
}

export function greet(name) {
    return `Hello, ${name}!`;
}
