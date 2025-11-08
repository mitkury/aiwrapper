import { LangOptions, LangResponseSchema, LanguageProvider } from "../../language-provider.ts";
import { LangMessage, LangMessageContent, LangMessageItem, LangMessageRole, LangMessages } from "../../messages.ts";
import { prepareBodyPartForOpenAIResponsesAPI } from "./openai-responses-messages.ts";
import { addInstructionAboutSchema } from "../../prompt-for-json.ts";
import { processServerEvents } from "../../../process-server-events.ts";
import { OpenAIResponseStreamHandler } from "./openai-responses-stream-handler.ts";
import { isZodSchema, validateAgainstSchema, zodToJsonSchema } from "../../schema/schema-utils.ts";
import {
  httpRequestWithRetry as fetch,
  HttpResponseWithRetries,
} from "../../../http-request.ts";


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
    messages.push(new LangMessage("user", prompt));

    return this.chat(messages, options);
  }

  async chat(messages: { role: LangMessageRole; items: LangMessageItem[] }[] | LangMessage[] | LangMessages, options?: LangOptions): Promise<LangMessages> {
    const msgCollection = messages instanceof LangMessages
      ? messages
      : new LangMessages(messages);

    await this.sendToApi(msgCollection, options);

    return msgCollection;
  }

  private buildStructuredOutput(schema: LangResponseSchema | undefined): Record<string, unknown> | undefined {
    if (!schema) {
      return undefined;
    }

    if (isZodSchema(schema)) {
      const jsonSchema = zodToJsonSchema(schema);
      return {
        text: {
          format: {
            type: "json_schema",
            name: "response_schema",
            schema: jsonSchema
          }
        }
      };
    } else {
      return {
        type: "json_schema",
        json_schema: schema
      };
    }
  }

  private buildRequestBody(msgCollection: LangMessages, options?: LangOptions): Record<string, unknown> {
    const structuredOutput = this.buildStructuredOutput(options?.schema);
    const bodyPart = prepareBodyPartForOpenAIResponsesAPI(msgCollection);

    return {
      model: this.model,
      ...{ stream: true },
      ...bodyPart,
      ...{ truncation: "auto" },
      ...structuredOutput,
      ...options?.providerSpecificBody,
    };
  }

  private async sendToApi(msgCollection: LangMessages, options?: LangOptions): Promise<void> {
    const body = this.buildRequestBody(msgCollection, options);

    const req = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        Authorization: `Bearer ${this.apiKey}`,
        ...options?.providerSpecificHeaders,
      },
      body: JSON.stringify(body),
      on400Error: async (res: Response, _error: Error, reqOptions: HttpResponseWithRetries) => {
        const data = await res.text();
        const dataObj = JSON.parse(data);

        if (dataObj.error?.code?.includes('previous_response_not_found')) {
          // Find the last message with openaiResponseId by iterating backwards
          let lastMessageWithResponseId: LangMessage | undefined;
          for (let i = msgCollection.length - 1; i >= 0; i--) {
            if (msgCollection[i].meta?.openaiResponseId) {
              lastMessageWithResponseId = msgCollection[i];
              break;
            }
          }
          
          if (lastMessageWithResponseId) {
            delete lastMessageWithResponseId.meta.openaiResponseId;
            // Build new body that contains all messages (with the response id removed)
            const newBody = this.buildRequestBody(msgCollection, options);
            reqOptions.body = JSON.stringify(newBody);
          }

          return { retry: true };
        }

        // For other 400 errors, don't retry - the request is malformed
        throw new Error(data);
      },
    };

    const streamHander = new OpenAIResponseStreamHandler(msgCollection, options?.onResult);
    const response = await fetch(`${this.baseURL}/responses`, req);
    await processServerEvents(response, (data) => streamHander.handleEvent(data));

    // If we expect a structured output, validate the schema against the result
    if (options?.schema) {
      const validation = validateAgainstSchema(msgCollection.object, options.schema);
      if (!validation.valid) {
        throw new Error(`Schema validation failed: ${validation.errors.join(', ')}`);
      }
    }

    msgCollection.finished = true;

    // Automatically execute tools if the assistant requested them
    const toolResults = await msgCollection.executeRequestedTools();
    if (options?.onResult && toolResults) {
      options.onResult(toolResults);
    }
  }
}