import { describe, expect, it, vi } from 'vitest';
import { LangMessage, LangMessages } from '../../src/lang/messages.ts';
import {
  transformMessageToResponsesItems,
  transformMessagesToResponsesInput,
} from '../../src/lang/openai/responses/openai-responses-messages.ts';
import { OpenAIResponseStreamHandler } from '../../src/lang/openai/responses/openai-responses-stream-handler.ts';

describe('OpenAI Responses message conversion', () => {
  it('serializes tool calls as top-level items while preserving message order', () => {
    const messages = new LangMessages([
      new LangMessage('assistant', [
        { type: 'text', text: 'Let me check.' },
        {
          type: 'tool',
          name: 'get_weather',
          callId: 'call_123',
          arguments: { city: 'Paris' },
        },
        { type: 'text', text: 'I found it.' },
      ]),
    ]);

    expect(transformMessagesToResponsesInput(messages)).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Let me check.' }],
      },
      {
        type: 'function_call',
        call_id: 'call_123',
        name: 'get_weather',
        arguments: JSON.stringify({ city: 'Paris' }),
      },
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'I found it.' }],
      },
    ]);
  });

  it('does not emit an empty message around tool-only responses', () => {
    const message = new LangMessage('assistant', [
      {
        type: 'tool',
        name: 'get_weather',
        callId: 'call_123',
        arguments: {},
      },
    ]);

    expect(transformMessageToResponsesItems(message)).toEqual([
      {
        type: 'function_call',
        call_id: 'call_123',
        name: 'get_weather',
        arguments: '{}',
      },
    ]);
  });

  it('replays assistant images without requiring prompt metadata', () => {
    const message = new LangMessage('assistant', [
      { type: 'image', base64: 'aGVsbG8=', mimeType: 'image/png' },
    ]);

    expect(transformMessageToResponsesItems(message)).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: '<revised>I generated an image but no longer have a reference to it.</revised>',
          },
        ],
      },
    ]);
  });
});

describe('OpenAI Responses stream handling', () => {
  it('accepts provider-managed web search items without warnings', () => {
    const messages = new LangMessages('What is the weather?');
    const handler = new OpenAIResponseStreamHandler(messages);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    handler.handleEvent({
      type: 'response.created',
      response: { id: 'resp_123' },
    });
    handler.handleEvent({
      type: 'response.output_item.added',
      item: { id: 'ws_123', type: 'web_search_call', status: 'in_progress' },
    });
    handler.handleEvent({
      type: 'response.output_item.done',
      item: { id: 'ws_123', type: 'web_search_call', status: 'completed' },
    });
    handler.handleEvent({
      type: 'response.output_item.added',
      item: { id: 'msg_123', type: 'message', status: 'in_progress', content: [] },
    });
    handler.handleEvent({
      type: 'response.output_text.delta',
      item_id: 'msg_123',
      delta: 'Sunny',
    });

    expect(messages.answer).toBe('Sunny');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
