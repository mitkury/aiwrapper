import { LangOptions, LanguageProvider } from "../../language-provider.ts";
import { LangMessage, LangMessages } from "../../messages.ts";
import { prepareBodyPartForOpenAIResponsesAPI } from "./openai-responses-messages.ts";
import { addInstructionAboutSchema } from "../../prompt-for-json.ts";
import { processServerEvents } from "../../../process-server-events.ts";
import { OpenAIResponseStreamHandler } from "./openai-responses-stream-handler.ts";


/**
 * OpenAI-specific built-in tools
 */
export type OpenAIBuiltInTool =
  | { name: "web_search" }
  | { name: "file_search"; vector_store_ids: string[] }
  | { name: "mcp"; server_label: string; server_description: string; server_url: string; require_approval: "never" | "always" | "if_needed" }
  | { name: "image_generation" }
  | { name: "code_interpreter" }
  | { name: "computer_use" };

export type OpenAIResponsesOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
};

export class OpenAIResponsesLang extends LanguageProvider {

  private model: string;
  private apiKey: string;
  private baseURL = "https://api.openai.com/v1";

  constructor(options: OpenAIResponsesOptions) {
    super("OpenAI Responses");

    this.model = options.model;
    this.apiKey = options.apiKey;
  }

  async ask(prompt: string, options?: LangOptions): Promise<LangMessages> {
    const messages = new LangMessages();

    messages.push({ role: "user", content: prompt });

    return this.chat(messages, options);
  }

  async chat(messages: LangMessage[] | LangMessages, options?: LangOptions): Promise<LangMessages> {
    const msgCollection = messages instanceof LangMessages
      ? messages
      : new LangMessages(messages);

    await this.sendToApi(msgCollection, options);

    return msgCollection;
  }

  private async sendToApi(msgCollection: LangMessages, options?: LangOptions): Promise<void> {
    // If a schema is provided, strongly instruct the model to return JSON matching it
    if (options?.schema) {
      const baseInstruction = msgCollection.instructions || '';
      msgCollection.instructions = addInstructionAboutSchema(
        baseInstruction || 'Return only the JSON. No prose.',
        options.schema as any
      );
      // Also add a system message up front to bias the model strongly
      const sys = addInstructionAboutSchema('You must return ONLY JSON that matches this schema.', options.schema as any);
      (msgCollection as any).splice(0, 0, { role: 'system', content: sys });
    }

    const bodyPart = prepareBodyPartForOpenAIResponsesAPI(msgCollection);

    const body = {
      model: this.model,
      ...{ stream: true },
      ...bodyPart,
      ...{ truncation: "auto" },
      ...options?.providerSpecificBody,
    };

    const req = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        Authorization: `Bearer ${this.apiKey}`,
        ...options?.providerSpecificHeaders,
      },
      body: JSON.stringify(body),
    };

    const streamHander = new OpenAIResponseStreamHandler(msgCollection, options?.onResult);
    const response = await fetch(`${this.baseURL}/responses`, req);
    await processServerEvents(response, (data) => streamHander.handleEvent(data));

    msgCollection.finished = true;

    // Automatically execute tools if the assistant requested them
    const toolResults = await msgCollection.executeRequestedTools();
    if (options?.onResult && toolResults) {
      options.onResult(toolResults);
    }
  }
}