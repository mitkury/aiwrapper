import { describe, it, expect, assert } from 'vitest';
import { LangMessage, LangMessages, LangOptions, LanguageProvider, ToolRequest, ToolResult, z } from 'aiwrapper';
import { createLangTestRunner, printAvailableProviders } from '../utils/lang-gatherer.js';

// Show available providers for debugging
printAvailableProviders();

describe('OpenAI Responses Lang', () => {
  createLangTestRunner(runTest, {
    overrideProviders: ['openai']
  });
});

async function runTest(lang: LanguageProvider) {
  it('should be able to send with outdated response_id', async () => {
    const messages = new LangMessages();
    messages.addUserMessage("What is the capital of France?");
    messages.addAssistantMessage("Paris");
    messages.addUserMessage("What is the capital of Germany?");

    // Here we simulate that the last message has an outdated/wrong openaiResponseId
    // We we expect the provider to handle this and continue the conversation
    messages[messages.length - 1].meta = {
      openaiResponseId: 'resp_wrong-response-id'
    };

    const res = await lang.chat(messages);
    expect(res.answer.toLocaleLowerCase()).toContain('berlin');
  });

}
