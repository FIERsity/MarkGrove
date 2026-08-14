const KEY_WIDTH = 20;
const DEFAULT_GAP = 1_000_000n;

function encode(value: bigint): string {
  return value.toString().padStart(KEY_WIDTH, "0");
}
function decode(value: string | null | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

export function initialOrderKey(index: number): string {
  return encode(BigInt(index + 1) * DEFAULT_GAP);
}

export function orderKeyBetween(previous?: string | null, next?: string | null): string | null {
  const left = decode(previous);
  const right = decode(next);
  if (left === null && right === null) return initialOrderKey(0);
  if (left === null && right !== null) return right > 1n ? encode(right / 2n) : null;
  if (left !== null && right === null) return encode(left + DEFAULT_GAP);
  if (left !== null && right !== null && right - left > 1n) return encode(left + (right - left) / 2n);
  return null;
}
