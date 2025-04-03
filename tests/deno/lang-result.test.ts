import { assertEquals } from "https://deno.land/std/testing/asserts.ts";
import { LangResult } from "../../src/lang/language-provider.ts";

// Simple test to verify the new LangResult class behaves as expected
Deno.test("LangResult - addUserMessage adds message to array", () => {
  const initialMessages = [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there!" }
  ];
  
  const result = new LangResult(initialMessages);
  result.addUserMessage("How are you?");
  
  assertEquals(result.messages.length, 3);
  assertEquals(result.messages[2].role, "user");
  assertEquals(result.messages[2].content, "How are you?");
});

Deno.test("LangResult - messages are modified in-place", () => {
  const initialMessages = [
    { role: "user", content: "Hello" }
  ];
  
  const result = new LangResult(initialMessages);
  
  // Test that the original array reference is maintained
  const originalRef = result.messages;
  result.addUserMessage("Another message");
  
  assertEquals(result.messages, originalRef);
  assertEquals(result.messages.length, 2);
});

Deno.test("LangResult - addToolUseMessage adds tool results", () => {
  const initialMessages = [
    { role: "user", content: "What's the weather?" }
  ];
  
  const result = new LangResult(initialMessages);
  result.addToolUseMessage([{
    toolId: "weather-123",
    result: { temperature: 72, condition: "sunny" }
  }]);
  
  assertEquals(result.messages.length, 2);
  assertEquals(result.messages[1].role, "tool");
  assertEquals(result.messages[1].content.length, 1);
  assertEquals(result.messages[1].content[0].toolId, "weather-123");
});

// Verify that toString() returns the answer property
Deno.test("LangResult - toString returns answer", () => {
  const result = new LangResult([]);
  result.answer = "This is the answer";
  
  assertEquals(result.toString(), "This is the answer");
});