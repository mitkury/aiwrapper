import { describe, it, expect } from 'vitest';
import { Lang } from '../../dist/index.js';

describe('Tool calling - streaming argument assembly (mock provider)', () => {
  it('assembles partial JSON arguments across tool_call deltas', async () => {
    const mock = Lang.mockOpenAI({
      mockToolCalls: [
        {
          id: 'call_1',
          name: 'get_weather',
          argumentsChunks: ['{"location": "San', ' Francisco", "unit": "c"}']
        }
      ]
    });

    const result = await mock.chat([{ role: 'user', content: 'What is the weather?' }], {
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather by location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' },
              unit: { type: 'string', enum: ['c', 'f'] }
            },
            required: ['location']
          }
        }
      ]
    });

    expect(result.finished).toBe(true);
    expect(result.tools).toBeDefined();
    expect(result.tools?.length).toBe(1);
    const call = result.tools![0];
    expect(call.id).toBe('call_1');
    expect(call.name).toBe('get_weather');
    expect(call.arguments).toEqual({ location: 'San Francisco', unit: 'c' });
  });
});