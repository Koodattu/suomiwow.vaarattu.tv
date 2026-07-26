export function orderCharacterAccountPairIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function createCharacterAccountPairKey(a: string, b: string): string {
  return orderCharacterAccountPairIds(a, b).join(":");
}
