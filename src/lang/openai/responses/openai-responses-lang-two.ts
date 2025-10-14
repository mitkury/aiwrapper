import { LangOptions, LanguageProvider } from "../../language-provider.ts";
import { LangMessage, LangMessages } from "../../messages.ts";
import { OpenAIResponsesOptions } from "../openai-responses-lang.ts";
import { prepareBodyPartForOpenAIResponsesAPI } from "./openai-responses-messages.ts";
import { processResponseStream } from "../../../process-response-stream.ts";
import { OpenAIResponseStreamHandler } from "./openai-responses-stream-handler.ts";

export type OpenAIResponseItem = {
  id: string;
  type: string;
  // We link our messages to items so we can mutate them as items are updated
  targetMessage?: LangMessage;
  [key: string]: any;
}

export class OpenAIResponsesLangTwo extends LanguageProvider {

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
    const bodyPart = prepareBodyPartForOpenAIResponsesAPI(msgCollection);

    const body = {
      model: this.model,
      ...{ stream: true },
      ...bodyPart,
      // @TODO: have a function that calculates the maxTokens (take a look at other providers for that)
      ...(typeof options?.maxTokens === 'number' ? { max_output_tokens: options.maxTokens } : {}),
    };

    const req = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
    };

    const streamHander = new OpenAIResponseStreamHandler(msgCollection, options?.onResult);
    const response = await fetch(`${this.baseURL}/responses`, req);
    await processResponseStream(response, (data) => streamHander.handleEvent(data));

    msgCollection.finished = true;
    const toolResults = await msgCollection.executeRequestedTools();
    if (options?.onResult && toolResults) options.onResult(toolResults);
  }
}