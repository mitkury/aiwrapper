import { describe, it, expect } from 'vitest';
import { Lang, LangMessages } from 'aiwrapper';
import { applyDiff_v4a } from 'aiwrapper';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const apiKey = process.env.OPENAI_API_KEY;

// Get test directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDir = path.join(__dirname, 'apply-patch-test');

describe.skipIf(!apiKey)('OpenAI built-in tools', () => {
  /*
  it('should use web_search tool', async () => {
    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-4o' });

    const messages = new LangMessages('What is the current weather in Paris in celsius? If you find the information, start with "The current weather in Paris" and if not - "I couldn\'t find the information"', {
      tools: [{ name: 'web_search' }]
    });

    const res = await lang.chat(messages);

    expect(res.answer).toBeDefined();
    expect(res.answer.toLocaleLowerCase()).toContain('the current weather in paris');
    expect(res.finished).toBe(true);
  });
  */

  it('should use apply_patch tool', async () => {
    // Clean up test directory before starting
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-5.1' });

    const messages = new LangMessages(
      'Create a new markdown document with an h1 title "Hello!" and a paragraph "This is a test" in ./test.md',
      {
        tools: [{ name: 'apply_patch' }]
      }
    );

    const res = await lang.chat(messages);

    expect(res.answer).toBeDefined();
    expect(res.finished).toBe(true);

    // Get the last assistant message
    let lastMessage = res[res.length - 1];
    // Find the last assistant message (in case tool results were added)
    for (let i = res.length - 1; i >= 0; i--) {
      if (res[i].role === 'assistant') {
        lastMessage = res[i];
        break;
      }
    }
    expect(lastMessage.role).toBe('assistant');

    // Find all apply_patch tool calls
    const patchCalls = lastMessage.toolRequests.filter(
      (t) => t.name === 'apply_patch'
    );

    expect(patchCalls.length).toBeGreaterThan(0);

    // Apply each patch
    const toolResults: any[] = [];
    for (const call of patchCalls) {
      const { operation, status } = call.arguments;
      expect(operation).toBeDefined();
      expect(operation.type).toBeDefined();
      expect(operation.path).toBeDefined();

      const filePath = path.join(testDir, operation.path);

      try {
        if (operation.type === 'create_file') {
          const content = applyDiff_v4a('', operation.diff, 'create');
          fs.writeFileSync(filePath, content, 'utf-8');
          toolResults.push({
            type: 'tool-result',
            name: 'apply_patch',
            callId: call.callId,
            result: {
              status: 'completed',
              output: `Created ${operation.path}`,
            },
          });
        } else if (operation.type === 'update_file') {
          const current = fs.existsSync(filePath)
            ? fs.readFileSync(filePath, 'utf-8')
            : '';
          const updated = applyDiff_v4a(current, operation.diff);
          fs.writeFileSync(filePath, updated, 'utf-8');
          toolResults.push({
            type: 'tool-result',
            name: 'apply_patch',
            callId: call.callId,
            result: {
              status: 'completed',
              output: `Updated ${operation.path}`,
            },
          });
        } else if (operation.type === 'delete_file') {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          toolResults.push({
            type: 'tool-result',
            name: 'apply_patch',
            callId: call.callId,
            result: {
              status: 'completed',
              output: `Deleted ${operation.path}`,
            },
          });
        }
      } catch (error: any) {
        toolResults.push({
          type: 'tool-result',
          name: 'apply_patch',
          callId: call.callId,
          result: {
            status: 'failed',
            output: `Error: ${error.message}`,
          },
        });
      }
    }

    // Add tool results and continue conversation
    if (toolResults.length > 0) {
      res.addToolResultsMessage(toolResults);

      // Continue the conversation to let the model know the patches were applied
      const followup = await lang.chat(res);

      expect(followup.answer).toBeDefined();
      expect(followup.finished).toBe(true);

      // Verify the file was created
      const testFilePath = path.join(testDir, 'test.md');
      expect(fs.existsSync(testFilePath)).toBe(true);

      const fileContent = fs.readFileSync(testFilePath, 'utf-8');
      expect(fileContent).toContain('Hello!');
      expect(fileContent).toContain('This is a test');
    }

    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

