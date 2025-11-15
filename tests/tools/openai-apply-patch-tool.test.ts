import { describe, it, expect } from 'vitest';
import { ChatAgent, Lang, LangMessages } from 'aiwrapper';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createTestApplyPatchHandler, createTestApplyPatchTool } from '../utils/apply-patch-handler.ts';

const apiKey = process.env.OPENAI_API_KEY;

// Get test directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testOutputDir = path.join(__dirname, 'test-output');

function prepareTestDirectory(testName: string) {
  const testDir = path.join(testOutputDir, testName);
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  fs.mkdirSync(testDir, { recursive: true });
  return testDir;
}

describe.skipIf(!apiKey)('OpenAI Apply Patch Tool', () => {

  it('should use apply_patch tool with handler', async () => {
    const test1Path = prepareTestDirectory('test-1');

    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-5.1' });

    // Define apply_patch handler / patch harness using shared test utility
    const applyPatchHandler = createTestApplyPatchHandler(test1Path);

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
    const testFilePath = path.join(test1Path, 'test.md');
    expect(fs.existsSync(testFilePath)).toBe(true);

    const fileContent = fs.readFileSync(testFilePath, 'utf-8');
    expect(fileContent).toContain('Hello!');
    expect(fileContent).toContain('This is a test');
  });

  it('should use apply_patch tool in an agent', async () => {

    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-5.1' });
    const agent = new ChatAgent(lang);

    const test2Path = prepareTestDirectory('test-2');
    
    agent.messages.availableTools = [createTestApplyPatchTool(test2Path)];

    agent.messages.addUserMessage("Create a new markdown document with an h1 title 'Testing Apply Patch' and a paragraph 'This is the first paragraph.' in ./test-2.md; Don't add any other content");
    let result = await agent.run();

    agent.messages.addUserMessage("Now let's add an h2 subtitle to our paragraph - 'Subtitle 1' and then create a new paragpraph with an h2 subtitle: 'Subtitle 2' and a paragraph 'This is the second paragraph.' within the same document");
    result = await agent.run();

    agent.messages.addUserMessage("And let's make sure we have an empty line at the top and the bottom of each paragraph and subtitle, except the top and bottom of the document, no more than 2 lines");
    result = await agent.run();

    agent.messages.addUserMessage("And add a very last paragraph without a subtitle: 'This is the final paragraph.");
    result = await agent.run();

    const expectedFinalResult = `# Testing Apply Patch

## Subtitle 1

This is the first paragraph.

## Subtitle 2

This is the second paragraph.

This is the final paragraph.`;

    const filaRestult = fs.readFileSync(path.join(test2Path, 'test-2.md'), 'utf-8').trim();

    expect(filaRestult).toBe(expectedFinalResult);
  });

  it('should program with apply_patch tool', async () => { 
    const lang = Lang.openai({ apiKey: apiKey as string, model: 'gpt-5.1' });
    const agent = new ChatAgent(lang);
    const testPath = prepareTestDirectory('test-3');
    agent.messages.availableTools = [createTestApplyPatchTool(testPath)];

    agent.messages.addUserMessage('Create a simple JS program in about 30 lines of code on any topic without any dependencies, just browser API. Put it in "./program.js"');
    let result = await agent.run();

    agent.messages.addUserMessage('Add a console.log with "Hello, world!" at the start of the program');
    result = await agent.run();

    agent.messages.addUserMessage('Add a console.log with "Goodbye, world!" at the end of the program');
    result = await agent.run();

    const programContent = fs.readFileSync(path.join(testPath, 'program.js'), 'utf-8');
    expect(programContent).toContain('console.log("Hello, world!")');
    expect(programContent).toContain('console.log("Goodbye, world!")');

    console.log(result.answer);
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

