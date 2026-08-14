export type StreamingTextSegmenterOptions = {
  /** Flush a clause when it grows this large without sentence punctuation. */
  maxBufferedCharacters?: number;
  /** Avoid tiny TTS requests unless punctuation clearly ends a sentence. */
  minimumSegmentCharacters?: number;
};

export class StreamingTextSegmenter {
  private buffer = "";
  private readonly maxBufferedCharacters: number;
  private readonly minimumSegmentCharacters: number;

  constructor(options: StreamingTextSegmenterOptions = {}) {
    this.maxBufferedCharacters = options.maxBufferedCharacters ?? 180;
    this.minimumSegmentCharacters = options.minimumSegmentCharacters ?? 18;
    if (!Number.isInteger(this.maxBufferedCharacters) || this.maxBufferedCharacters < 1) {
      throw new RangeError("maxBufferedCharacters must be a positive integer");
    }
    if (!Number.isInteger(this.minimumSegmentCharacters) || this.minimumSegmentCharacters < 1) {
      throw new RangeError("minimumSegmentCharacters must be a positive integer");
    }
  }

  push(delta: string): string[] {
    if (!delta) return [];
    this.buffer += delta;
    return this.takeReadySegments();
  }

  flush(): string[] {
    const final = this.buffer.trim();
    this.buffer = "";
    return final ? [final] : [];
  }

  clear(): void {
    this.buffer = "";
  }

  private takeReadySegments(): string[] {
    const segments: string[] = [];

    while (this.buffer) {
      const sentenceEnd = findSentenceEnd(this.buffer);
      if (sentenceEnd >= 0) {
        const segment = this.buffer.slice(0, sentenceEnd).trim();
        this.buffer = this.buffer.slice(sentenceEnd).trimStart();
        if (segment) segments.push(segment);
        continue;
      }

      if (this.buffer.length < this.maxBufferedCharacters) break;
      const splitAt = findClauseBoundary(this.buffer, this.maxBufferedCharacters);
      const segment = this.buffer.slice(0, splitAt).trim();
      this.buffer = this.buffer.slice(splitAt).trimStart();
      if (segment.length >= this.minimumSegmentCharacters) {
        segments.push(segment);
      } else {
        this.buffer = `${segment} ${this.buffer}`.trim();
        break;
      }
    }

    return segments;
  }
}

function findSentenceEnd(text: string): number {
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\n") return index + 1;
    if (!".!?".includes(character)) continue;
    const next = text[index + 1];
    if (next === undefined || /\s/.test(next)) return index + 1;
  }
  return -1;
}

function findClauseBoundary(text: string, limit: number): number {
  const prefix = text.slice(0, limit + 1);
  const comma = Math.max(prefix.lastIndexOf(", "), prefix.lastIndexOf("; "), prefix.lastIndexOf(": "));
  if (comma >= Math.floor(limit * 0.55)) return comma + 1;
  const whitespace = prefix.lastIndexOf(" ");
  return whitespace > 0 ? whitespace : Math.min(limit, text.length);
}
