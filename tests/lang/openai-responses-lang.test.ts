import { describe, it, expect, assert } from 'vitest';
import { LangMessage, LangMessages, LangOptions, LanguageProvider, ToolRequest, ToolResult, z } from 'aiwrapper';
import { createLangTestRunner, printAvailableProviders } from '../utils/lang-gatherer.js';
import { readImageBase64 } from '../utils/test-images.ts';

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
    messages[messages.length - 2].meta = {
      openaiResponseId: 'resp_wrong-response-id'
    };

    const res = await lang.chat(messages);
    expect(res.answer.toLocaleLowerCase()).toContain('berlin');
  });

  /*
  it('should correctly convert assistant images to output_text format', async () => {
    // Read the test image
    const { base64, mimeType } = await readImageBase64(import.meta.url, '../img-in/image-in-test/test-image.jpg');
    
    // Simulate a scenario where user asks to create a photo of a cat
    const messages = new LangMessages();
    messages.addUserMessage("Create a photo of a cat");
    
    // Simulate that the assistant "created" the image by adding it to an assistant message
    messages.addAssistantImage({ kind: 'base64', base64, mimeType });
    
    // Verify the image is in the message
    expect(messages.assistantImages.length).toBe(1);
    expect(messages.assistantImages[0].base64).toBe(base64);
    
    // Add a "thanks" message from the user and continue the conversation
    messages.addUserMessage("Thanks!");
    
    // Continue the conversation - this will test that the assistant image is correctly handled
    // when sending the conversation back to the API
    const res = await lang.chat(messages);
    
    // Verify we got a response
    expect(res).toBeDefined();
    expect(res.length).toBeGreaterThan(2); // Should have at least user, assistant (image), user (thanks), assistant (response)
    
    // Verify the assistant message with the image is still present
    // Find the assistant message that contains the image (it should be the second-to-last message)
    const assistantMessageWithImage = res.find((msg, idx) => 
      msg.role === 'assistant' && 
      Array.isArray(msg.content) &&
      (msg.content as any[]).some((part: any) => part.type === 'image')
    );
    expect(assistantMessageWithImage).toBeDefined();
    
    // Verify the image is still in that message
    if (assistantMessageWithImage) {
      const images = assistantMessageWithImage.images;
      expect(images.length).toBe(1);
      expect(images[0].base64).toBe(base64);
    }
    
    // Verify we got a final response from the assistant
    expect(res.answer.length).toBeGreaterThan(0);
  });
  */
}
