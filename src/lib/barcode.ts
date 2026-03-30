// Internal barcode generation for products
// Uses Code128 format: prefix "MPC" + 9 random digits

function generateRandomDigits(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

export function generateBarcode(): string {
  const timestamp = Date.now().toString().slice(-6);
  const random = generateRandomDigits(4);
  return `MPC${timestamp}${random}`;
}
