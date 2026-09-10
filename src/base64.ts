/** Encode a byte view without Node globals or copying its backing buffer. */
export function encodeBytesAsBase64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const value = (bytes[index] << 16)
      | ((hasSecond ? bytes[index + 1] : 0) << 8)
      | (hasThird ? bytes[index + 2] : 0);
    result += alphabet[(value >> 18) & 63];
    result += alphabet[(value >> 12) & 63];
    result += hasSecond ? alphabet[(value >> 6) & 63] : "=";
    result += hasThird ? alphabet[value & 63] : "=";
  }
  return result;
}
