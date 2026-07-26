export type Pair<T> = readonly [T, T];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const swap = <T,>([a, b]: Pair<T>): Pair<T> => [b, a];
