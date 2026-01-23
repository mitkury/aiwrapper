import { assert, describe, expect, it } from "vitest";
import { LangMessage, LangMessages, LanguageProvider, z } from "aiwrapper";
import {
  createLangTestRunner,
  LangGathererOptions,
  printAvailableProviders,
} from "../utils/lang-gatherer.js";

const langTestOptions = {
  providers: ["anthropic", "openai", "openrouter"],
} as LangGathererOptions;

printAvailableProviders(langTestOptions);

describe("Handle invalid tool use", () => {
  createLangTestRunner(runTest, langTestOptions);
});

async function runTest(lang: LanguageProvider) {
  it("handles interrupted tool use", async () => {
    const messages = new LangMessages(undefined, {
      tools: [
        {
          name: "get_random_number",
          description: "Return a predefined random number",
          parameters: { type: "object", properties: {} },
          handler: (_args: any) => 111,
        },
      ],
    });
    messages.addUserMessage("Give me a random number using a tool");

    const res = await lang.chat(messages);

    // We expect that the last message is a tool result
    assert(res.length >= 2);
    assert(res[res.length - 1].role === "tool-results");

    // Going to remove the tool result to simulate an interrupted tool use
    const interruptedMessages = new LangMessages(
      res.slice(0, res.length - 1)
    );
    interruptedMessages.availableTools = messages.availableTools;

    interruptedMessages.addUserMessage(
      "So?"
    );

    // Send the interrupted conversation back to the model
    const finalRes = await lang.chat(interruptedMessages);

    // Expect to get an answer without errors or another tool result
    const lastMsgRole = finalRes[finalRes.length - 1].role;
    assert(lastMsgRole === "assistant" || lastMsgRole === "tool-results");

  });
}
