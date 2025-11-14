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

describe.skipIf(!apiKey)('OpenAI Apply Patch Tool', () => {

  it('should use apply_patch tool with handler', async () => {
    // Clean up test directory before starting
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-5.1' });

    // Define apply_patch handler / patch harness
    const applyPatchHandler = async (args: Record<string, any>) => {
      const { operation } = args;
      if (!operation || !operation.type || !operation.path) {
        return {
          status: 'failed',
          output: 'Invalid operation: missing type or path',
        };
      }

      const filePath = path.join(testDir, operation.path);

      try {
        if (operation.type === 'create_file') {
          const content = applyDiff_v4a('', operation.diff, 'create');
          fs.writeFileSync(filePath, content, 'utf-8');
          return {
            status: 'completed',
            output: `Created ${operation.path}`,
          };
        } else if (operation.type === 'update_file') {
          const current = fs.existsSync(filePath)
            ? fs.readFileSync(filePath, 'utf-8')
            : '';
          const updated = applyDiff_v4a(current, operation.diff);
          fs.writeFileSync(filePath, updated, 'utf-8');
          return {
            status: 'completed',
            output: `Updated ${operation.path}`,
          };
        } else if (operation.type === 'delete_file') {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          return {
            status: 'completed',
            output: `Deleted ${operation.path}`,
          };
        } else {
          return {
            status: 'failed',
            output: `Unknown operation type: ${operation.type}`,
          };
        }
      } catch (error: any) {
        return {
          status: 'failed',
          output: `Error: ${error.message}`,
        };
      }
    };

    const messages = new LangMessages(
      'Create a new markdown document with an h1 title "Hello!" and a paragraph "This is a test" in ./test.md',
      {
        tools: [
          {
            name: 'apply_patch',
            description: 'Apply patches to files',
            parameters: {},
            handler: applyPatchHandler,
          },
        ],
      }
    );

    const res = await lang.chat(messages);

    expect(res.answer).toBeDefined();
    expect(res.finished).toBe(true);

    // Verify the file was created by the handler
    const testFilePath = path.join(testDir, 'test.md');
    expect(fs.existsSync(testFilePath)).toBe(true);

    const fileContent = fs.readFileSync(testFilePath, 'utf-8');
    expect(fileContent).toContain('Hello!');
    expect(fileContent).toContain('This is a test');

    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should throw error when apply_patch tool is used without handler', async () => {
    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-5.1' });

    const messages = new LangMessages('Test message', {
      tools: [{ name: 'apply_patch' }],
    });

    await expect(lang.chat(messages)).rejects.toThrow(
      'The apply_patch tool requires a handler. Please provide a handler function when defining the tool.',
    );
  });
});

