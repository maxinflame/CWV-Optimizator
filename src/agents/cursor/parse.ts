export function extractHypothesis(text: string): string | undefined {
  const jsonMatch = text.match(
    /\{[\s\S]*"hypothesis"\s*:\s*"((?:\\.|[^"\\])*)"[\s\S]*\}/,
  );
  if (jsonMatch?.[1]) {
    try {
      return JSON.parse(`"${jsonMatch[1]}"`) as string;
    } catch {
      return jsonMatch[1];
    }
  }
  const labeled = text.match(
    /(?:hypothesis|гипотеза)\s*[:\-–—]\s*(.+?)(?:\n\n|$)/i,
  );
  if (labeled?.[1]?.trim()) return labeled[1].trim();
  const trimmed = text.trim();
  if (trimmed) return trimmed.slice(0, 2000);
  return undefined;
}
