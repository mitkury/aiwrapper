import { describe, it, expect } from 'vitest';
import { LangMessages, LangOptions, LanguageProvider } from 'aiwrapper';
import { createLangTestRunner } from '../utils/lang-gatherer.js';

describe('Tools', () => {
  createLangTestRunner(runTest);
});

async function runTest(lang: LanguageProvider) {
  it('should pick the correct tool among many', async () => {
    const messages = new LangMessages([
      {
        role: 'user',
        content: 'I need a color. Use the appropriate tool to get a color, then reply only with that color.'
      }
    ] as any, {
      tools: [
        {
          name: 'get_random_number',
          description: 'Return a predefined random number',
          parameters: { type: 'object', properties: {} },
          handler: (_args: any) => 111
        },
        {
          name: 'get_random_word',
          description: 'Return a predefined random word',
          parameters: { type: 'object', properties: {} },
          handler: (_args: any) => 'alpha'
        },
        {
          name: 'get_random_color',
          description: 'Return a predefined random color',
          parameters: { type: 'object', properties: {} },
          handler: (_args: any) => 'red'
        }
      ]
    });

    const res = await lang.chat(messages);

    expect(res.length).toBeGreaterThanOrEqual(2);

    // Verify tool selection via normalized fields or transcript
    const requested = ((res as any).tools || (res as any).toolsRequested || []) as any[];
    const transcriptToolMsgs = res.filter((m: any) => m.role === 'tool');
    const requestedNames = [
      ...requested.map((c: any) => c.name),
      ...transcriptToolMsgs.flatMap((m: any) => (Array.isArray(m.content) ? m.content.map((c: any) => c.name) : []))
    ];
    expect(requestedNames).toContain('get_random_color');

    // Find latest tool-results and validate
    const toolResultsMsg = [...res].reverse().find((m: any) => m.role === 'tool-results');
    expect(toolResultsMsg).toBeDefined();
    expect(Array.isArray((toolResultsMsg as any).content)).toBe(true);
    const toolResult = (toolResultsMsg as any).content[0];
    expect(toolResult.toolId).toBeDefined();
    expect(toolResult.result).toBe('red');

    const finalRes = await lang.chat(res);
    expect(finalRes.answer.toLowerCase()).toContain('red');
  });

  it('should call multiple tools (parallel or sequential) and combine results', async () => {
    let messages = new LangMessages([
      {
        role: 'user',
        content: 'For city Paris, get weather and population using the tools, then return a single sentence including the temperature in C and the population.'
      }
    ] as any, {
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string' }
            },
            required: ['city']
          },
          handler: (args: any) => ({ city: args.city, tempC: 21 })
        },
        {
          name: 'get_population',
          description: 'Get population for a city',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string' }
            },
            required: ['city']
          },
          handler: (args: any) => ({ city: args.city, population: 1000000 })
        }
      ]
    });

    const called = new Set<string>();
    let sawWeather = false;
    let sawPopulation = false;

    // Allow up to 3 rounds to collect both tool calls (parallel or sequential)
    for (let i = 0; i < 3 && (called.size < 2); i++) {
      const res = await lang.chat(messages);

      expect(res.length).toBeGreaterThanOrEqual(2);

      // Collect requested tool names from normalized fields or transcript
      const requested = ((res as any).tools || (res as any).toolsRequested || []) as any[];
      for (const c of requested) called.add(c.name);
      const transcriptToolMsgs = res.filter((m: any) => m.role === 'tool');
      for (const m of transcriptToolMsgs) {
        if (Array.isArray((m as any).content)) {
          for (const c of (m as any).content as any[]) called.add(c.name);
        }
      }

      // Gather tool results from the latest tool-results message
      const toolResultsMsg = [...res].reverse().find((m: any) => m.role === 'tool-results');
      if (toolResultsMsg && Array.isArray((toolResultsMsg as any).content)) {
        for (const r of (toolResultsMsg as any).content as any[]) {
          const val = r.result;
          if (val && typeof val === 'object') {
            if (typeof val.tempC === 'number') sawWeather = sawWeather || val.tempC === 21;
            if (typeof val.population === 'number') sawPopulation = sawPopulation || val.population === 1000000;
          }
        }
      }

      messages = res; // continue the conversation if needed
    }

    expect(called.has('get_weather')).toBe(true);
    expect(called.has('get_population')).toBe(true);

    expect(sawWeather).toBe(true);
    expect(sawPopulation).toBe(true);

    const finalRes = await lang.chat(messages);
    expect(finalRes.answer.toLowerCase()).toContain('paris');
    expect(finalRes.answer).toMatch(/21/);
    expect(finalRes.answer).toMatch(/(1000000|1,000,000|1 000 000)/);
  });

  it('should handle tool arguments and produce correct result (streaming)', async () => {
    let streamingAnswer = '';
    const messages = new LangMessages([
      {
        role: 'user',
        content: 'Compute 7 multiplied by 6 using the tools, then reply with only the number.'
      }
    ] as any, {
      tools: [
        {
          name: 'add',
          description: 'Add two numbers',
          parameters: {
            type: 'object',
            properties: { a: { type: 'number' }, b: { type: 'number' } },
            required: ['a', 'b']
          },
          handler: (_args: any) => 42
        },
        {
          name: 'multiply',
          description: 'Multiply two numbers',
          parameters: {
            type: 'object',
            properties: { a: { type: 'number' }, b: { type: 'number' } },
            required: ['a', 'b']
          },
          handler: (_args: any) => 42
        }
      ]
    });

    const res = await lang.chat(messages);

    expect(res.length).toBeGreaterThanOrEqual(2);

    // Verify a tool was requested
    const requested = ((res as any).tools || (res as any).toolsRequested || []) as any[];
    const requestedNames = requested.map((c: any) => c.name);
    const transcriptToolMsgs = res.filter((m: any) => m.role === 'tool');
    const transcriptNames = transcriptToolMsgs.flatMap((m: any) => (Array.isArray(m.content) ? m.content.map((c: any) => c.name) : []));
    const allNames = new Set<string>([...requestedNames, ...transcriptNames]);
    expect(['multiply', 'add'].some(n => allNames.has(n))).toBe(true);

    // Verify tool results contained 42
    const toolResultsMsg = [...res].reverse().find((m: any) => m.role === 'tool-results');
    expect(toolResultsMsg).toBeDefined();
    const toolResultArr = (toolResultsMsg as any).content as any[];
    expect(Array.isArray(toolResultArr)).toBe(true);
    expect(toolResultArr.some((r: any) => r.result === 42)).toBe(true);

    const options: LangOptions = {
      onResult: (msgs) => {
        streamingAnswer = msgs.content as string;
      }
    };

    const finalRes = await lang.chat(res, options);
    expect(finalRes.answer).toContain('42');
    expect(streamingAnswer).toBe(finalRes.answer);
  });
}

