import { describe, it, expect } from 'vitest';
import { Lang, executeToolsAndContinue } from '../../dist/index.js';

/**
 * This test verifies that we can:
 * - Receive a streaming tool_call
 * - Execute it externally
 * - Append tool results to messages
 * - Continue the chat successfully
 */
describe('Tool calling - execute and continue (mock provider)', () => {
  it('executes a tool and continues chat', async () => {
    const mock = Lang.mockOpenAI({
      mockToolCalls: [
        {
          id: 'call_1',
          name: 'add',
          argumentsChunks: ['{"a": 2, "b": ', '3}']
        }
      ],
      mockResponseText: 'Ignored for tool_calls'
    });

    const initial = await mock.chat([{ role: 'user', content: 'Add 2 and 3 using the add tool.' }], {
      tools: [
        {
          name: 'add',
          description: 'Add two numbers',
          parameters: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' }
            },
            required: ['a', 'b']
          }
        }
      ]
    });

    expect(initial.tools).toBeDefined();
    expect(initial.tools?.[0].name).toBe('add');
    expect(initial.tools?.[0].arguments).toEqual({ a: 2, b: 3 });

    const registry = {
      add: ({ a, b }: any) => a + b
    };

    const continued = await executeToolsAndContinue(mock, initial, registry);

    expect(continued.finished).toBe(true);
    expect(continued.answer.length).toBeGreaterThan(0);
    // Ensure a tool message was appended
    const hasToolMessage = continued.messages.some(m => m.role === 'tool');
    expect(hasToolMessage).toBe(true);
  });
});