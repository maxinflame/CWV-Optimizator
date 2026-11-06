export interface Statistics {
  samples: number[];
  median: number;
  p95: number;
  min: number;
  max: number;
  spread: number;
}

export function summarize(samples: number[]): Statistics {
  if (
    !samples.length ||
    samples.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error("Invalid metric samples");
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[middle]!
      : sorted[middle - 1]! + (sorted[middle]! - sorted[middle - 1]!) / 2;
  const min = sorted[0]!;
  const max = sorted.at(-1)!;
  return {
    samples: [...samples],
    median,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    min,
    max,
    spread: max - min,
  };
}
