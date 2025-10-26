import { describe, it, expect } from 'vitest';

// Import internal util from built output (pretest builds dist)
import { calculateModelResponseTokens } from 'aiwrapper';

type AnyModel = any;

function createMockTokenModel(total: number | null, maxOutput: number | null, outputIsFixed?: number): AnyModel {
  return {
    context: {
      type: 'token',
      total,
      maxOutput,
      outputIsFixed,
    }
  };
}

const mockNonTokenModel: AnyModel = { context: { type: 'character' } };

const shortMessage = { role: 'user', content: 'Hello' };
const longMessage = { role: 'user', content: 'This is a longer message that will use more tokens than the short message. It should be approximately 25 tokens according to our rough estimation.' };

describe('calculateModelResponseTokens', () => {
  it('uses user maxTokens when within limits', () => {
    const got = calculateModelResponseTokens(createMockTokenModel(4000, 2000), [shortMessage], 500);
    expect(got).toBe(500);
  });

  it('returns default for non-token models', () => {
    const got = calculateModelResponseTokens(mockNonTokenModel, [shortMessage]);
    expect(got).toBe(2000);
  });

  it('returns maxOutput for fixed-output models', () => {
    const got = calculateModelResponseTokens(createMockTokenModel(8000, 4000, 1), [longMessage]);
    expect(got).toBe(4000);
  });

  it('clamps user maxTokens to model max for fixed-output models', () => {
    const lower = calculateModelResponseTokens(createMockTokenModel(8000, 4000, 1), [longMessage], 2000);
    expect(lower).toBe(2000);
    const higher = calculateModelResponseTokens(createMockTokenModel(8000, 4000, 1), [longMessage], 6000);
    expect(higher).toBe(4000);
  });

  it("returns maxOutput when there's enough space in dynamic context", () => {
    const got = calculateModelResponseTokens(createMockTokenModel(4000, 2000), [shortMessage]);
    expect(got).toBe(2000);
  });

  it('returns less than maxOutput when input is large', () => {
    const longInput = Array(50).fill(longMessage);
    const got = calculateModelResponseTokens(createMockTokenModel(4000, 2000), longInput);
    expect(got).toBeLessThan(2000);
    expect(got).toBeGreaterThanOrEqual(0);
  });

  it('handles null values gracefully', () => {
    const got = calculateModelResponseTokens(createMockTokenModel(null, 2000), [shortMessage]);
    expect(got).toBe(2000);
  });
});


