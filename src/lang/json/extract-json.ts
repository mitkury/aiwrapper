import { Jsonic } from "jsonic";

function findContainerEnd(text: string, startIndex: number): number {
  const brackets: string[] = [];
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const character = text[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === "{" || character === "[") {
      brackets.push(character);
      continue;
    }

    if (character !== "}" && character !== "]") continue;

    const expectedOpening = character === "}" ? "{" : "[";
    if (brackets.pop() !== expectedOpening) return -1;
    if (brackets.length === 0) return i;
  }

  return -1;
}

function getJSONCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{" && text[i] !== "[") continue;

    const endIndex = findContainerEnd(text, i);
    if (endIndex >= 0) {
      candidates.push(text.slice(i, endIndex + 1));
    }
  }
  return candidates;
}

function parseStrictJSON(candidates: string[]): object | null {
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (typeof value === "object" && value !== null) return value;
    } catch {
      // Try the next balanced container before falling back to Jsonic.
    }
  }
  return null;
}

function parseRelaxedJSON(candidates: string[]): object | null {
  for (const candidate of candidates) {
    try {
      const value: unknown = Jsonic(candidate);
      if (typeof value === "object" && value !== null) return value;
    } catch {
      // Keep looking for another JSON-like container.
    }
  }
  return null;
}

/**
 * Tries to extract JSON from a string.
 * Balanced containers are parsed strictly first, then retried with Jsonic.
 * @param str JSON along with other text
 * @returns An object or null if extraction fails
 */
export default function extractJSON(
  str: string,
  verbose = false,
): object | null {
  const candidates = getJSONCandidates(str);
  const value = parseStrictJSON(candidates) ?? parseRelaxedJSON(candidates);

  if (value === null && verbose) {
    console.error("Failed to extract JSON from the string: " + str);
  }

  return value;
}
