function sliceJsonObject(text: string, start: number): string | undefined {
  if (text[start] !== "{") return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

function findHypothesisObject(text: string): unknown | undefined {
  for (
    let start = text.indexOf("{");
    start >= 0;
    start = text.indexOf("{", start + 1)
  ) {
    const slice = sliceJsonObject(text, start);
    if (!slice) continue;
    try {
      const value = JSON.parse(slice) as unknown;
      if (
        value &&
        typeof value === "object" &&
        "hypothesis" in value &&
        typeof (value as { hypothesis: unknown }).hypothesis === "string" &&
        (value as { hypothesis: string }).hypothesis.trim()
      ) {
        return value;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Разбирает текстовый вывод Cursor CLI, сохраняя дополнительные поля ответа. */
export function parseCursorOutput(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // Дальше ищем объект гипотезы внутри текста.
    }
  }
  const embedded = findHypothesisObject(trimmed);
  if (embedded) return embedded;
  const hypothesis = extractHypothesis(trimmed);
  if (!hypothesis) return undefined;
  return { hypothesis, raw: text };
}

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
