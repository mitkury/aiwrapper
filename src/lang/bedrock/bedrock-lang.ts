import {
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  ContentBlock,
  ConverseStreamCommandInput,
  ConverseStreamCommandOutput,
  ImageBlock,
  ImageFormat,
  Message,
  Tool,
  ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { attachPartialResult, isAbortError } from "../../errors.js";
import {
  LanguageProvider,
} from "../language-provider.js";
import type {
  LangMessage,
  LangOptions,
} from "../language-provider.js";
import {
  fixToolResultsIfNeeded,
  isLangToolResultContent,
  LangMessages,
  normalizeLangToolResultImage,
} from "../messages.js";
import type {
  LangMessageItem,
  LangMessageItemImage,
  LangMessageRole,
  LangToolResultPart,
  LangToolWithHandler,
} from "../messages.js";
import {
  isZodSchema,
  validateAgainstSchema,
  zodToJsonSchema,
} from "../schema/schema-utils.js";
import { combineInstructions } from "../prompt-for-json.js";
import { BedrockStreamHandler } from "./bedrock-stream-handler.js";

export interface BedrockConverseClient {
  send(
    command: ConverseStreamCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<ConverseStreamCommandOutput>;
}

export type BedrockLangOptions = {
  client: BedrockConverseClient;
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  defaultOptions?: LangOptions;
};

type BedrockLangConfig = Omit<
  BedrockLangOptions,
  "client" | "defaultOptions"
>;

export class BedrockLang extends LanguageProvider {
  private readonly client: BedrockConverseClient;
  private readonly config: BedrockLangConfig;

  constructor(options: BedrockLangOptions) {
    if (options.model.trim().length === 0) {
      throw new Error("BedrockLang requires a non-empty model ID.");
    }
    super(options.model, options.defaultOptions);
    this.client = options.client;
    this.config = {
      model: options.model,
      systemPrompt: options.systemPrompt,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      stopSequences: options.stopSequences,
    };
  }

  async ask(prompt: string, options?: LangOptions): Promise<LangMessages> {
    return this.chat(new LangMessages(prompt), options);
  }

  async chat(
    messages:
      | { role: LangMessageRole; items: LangMessageItem[] }[]
      | LangMessage[]
      | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const resolvedOptions = this.resolveOptions(options);
    this.validateOptions(resolvedOptions);
    const result = this.beginRequest(
      messages instanceof LangMessages
        ? messages
        : new LangMessages(messages),
    );

    fixToolResultsIfNeeded(result);
    const request = this.buildRequest(result, resolvedOptions);
    const streamHandler = new BedrockStreamHandler(
      result,
      resolvedOptions?.onResult,
    );

    try {
      const response = await this.client.send(
        new ConverseStreamCommand(request),
        resolvedOptions?.signal
          ? { abortSignal: resolvedOptions.signal }
          : undefined,
      );
      if (!response.stream) {
        throw new Error("Bedrock ConverseStream returned no response stream.");
      }
      for await (const event of response.stream) {
        streamHandler.handleEvent(event);
      }
      streamHandler.assertComplete();
    } catch (error) {
      if (isAbortError(error)) {
        result.aborted = true;
        throw attachPartialResult(error, result);
      }
      throw error;
    }

    if (resolvedOptions?.schema) {
      const validation = validateAgainstSchema(
        result.object,
        resolvedOptions.schema,
      );
      if (!validation.valid) {
        throw new Error(
          `Schema validation failed: ${validation.errors.join(", ")}`,
        );
      }
    }

    result.finished = true;
    const toolResults = await result.executeRequestedTools();
    if (toolResults) {
      resolvedOptions?.onResult?.(toolResults);
    }
    return result;
  }

  protected transformMessagesForProvider(messages: LangMessages): Message[] {
    const providerMessages: Message[] = [];
    for (const message of messages) {
      let content: ContentBlock[];
      switch (message.role) {
        case "user":
          content = this.mapUserContent(message);
          break;
        case "assistant":
          content = this.mapAssistantContent(message);
          break;
        case "tool-results":
          content = this.mapToolResults(message);
          break;
      }
      if (content.length > 0) {
        const role = message.role === "assistant" ? "assistant" : "user";
        const previous = providerMessages.at(-1);
        if (previous?.role === role && previous.content) {
          previous.content.push(...content);
        } else {
          providerMessages.push({ role, content });
        }
      }
    }
    return providerMessages;
  }

  private buildRequest(
    messages: LangMessages,
    options?: LangOptions,
  ): ConverseStreamCommandInput {
    const instructions = combineInstructions(
      this.config.systemPrompt,
      messages.instructions,
    );
    const inferenceConfig = {
      ...(this.config.maxTokens !== undefined
        ? { maxTokens: this.config.maxTokens }
        : {}),
      ...(this.config.temperature !== undefined
        ? { temperature: this.config.temperature }
        : {}),
      ...(this.config.topP !== undefined ? { topP: this.config.topP } : {}),
      ...(this.config.stopSequences !== undefined
        ? { stopSequences: this.config.stopSequences }
        : {}),
    };
    const toolConfig = this.mapTools(messages);

    return {
      modelId: this.config.model,
      messages: this.transformMessagesForProvider(messages),
      ...(instructions ? { system: [{ text: instructions }] } : {}),
      ...(Object.keys(inferenceConfig).length > 0 ? { inferenceConfig } : {}),
      ...(toolConfig ? { toolConfig: { tools: toolConfig } } : {}),
      ...(options?.schema
        ? { outputConfig: this.mapOutputSchema(options.schema) }
        : {}),
      ...(options?.providerSpecificBody ?? {}),
    };
  }

  private validateOptions(options?: LangOptions): void {
    if (
      options?.providerSpecificHeaders &&
      Object.keys(options.providerSpecificHeaders).length > 0
    ) {
      throw new Error(
        "BedrockLang does not support providerSpecificHeaders. Configure custom headers through AWS SDK middleware.",
      );
    }
  }

  private mapUserContent(message: LangMessage): ContentBlock[] {
    const content: ContentBlock[] = [];
    for (const item of message.items) {
      switch (item.type) {
        case "text":
          if (item.text.length > 0) content.push({ text: item.text });
          break;
        case "image":
          content.push({ image: this.mapImage(item) });
          break;
        default:
          throw unsupportedMessageItem("user", item.type);
      }
    }
    return content;
  }

  private mapAssistantContent(message: LangMessage): ContentBlock[] {
    const content: ContentBlock[] = [];
    for (const item of message.items) {
      switch (item.type) {
        case "text":
          if (item.text.length > 0) content.push({ text: item.text });
          break;
        case "tool":
          content.push({
            toolUse: {
              toolUseId: item.callId,
              name: item.name,
              input: item.arguments ?? {},
            },
          });
          break;
        case "image":
          throw new Error(
            "Bedrock Converse only accepts images in user messages.",
          );
        case "reasoning":
          // Bedrock requires signed reasoning to be replayed unmodified. The
          // shared message type does not retain that signature, so omit it.
          break;
        case "tool-result":
          throw unsupportedMessageItem("assistant", item.type);
      }
    }
    return content;
  }

  private mapToolResults(message: LangMessage): ContentBlock[] {
    const content: ContentBlock[] = [];
    for (const item of message.items) {
      if (item.type !== "tool-result") {
        throw unsupportedMessageItem("tool-results", item.type);
      }
      content.push({
        toolResult: {
          toolUseId: item.callId,
          content: this.mapToolResultContent(item.result),
        },
      });
    }
    return content;
  }

  private mapToolResultContent(result: unknown): ToolResultContentBlock[] {
    if (isLangToolResultContent(result)) {
      if (result.content.length === 0) {
        throw new Error(
          "Bedrock tool content must contain at least one part.",
        );
      }
      return result.content.map(part => this.mapToolResultPart(part));
    }
    if (typeof result === "string") {
      return [{ text: result }];
    }
    return [{ json: toJsonDocument(result ?? null) }];
  }

  private mapToolResultPart(part: LangToolResultPart): ToolResultContentBlock {
    if (part.type === "text") {
      return { text: part.text };
    }
    const image = normalizeLangToolResultImage(part);
    if (image.kind === "url") {
      throw new Error(
        "Bedrock Converse does not accept remote image URLs; provide base64 or bytes instead.",
      );
    }
    return {
      image: this.mapBase64Image(image.base64, image.mimeType),
    };
  }

  private mapImage(image: LangMessageItemImage): ImageBlock {
    if (typeof image.base64 === "string" && image.base64.length > 0) {
      return this.mapBase64Image(
        image.base64,
        image.mimeType ?? "image/png",
      );
    }
    if (typeof image.url === "string" && image.url.length > 0) {
      const dataUrl = image.url.match(/^data:([^;,]+);base64,(.+)$/s);
      if (dataUrl) {
        return this.mapBase64Image(dataUrl[2], dataUrl[1]);
      }
      throw new Error(
        "Bedrock Converse does not accept remote image URLs; provide base64 or bytes instead.",
      );
    }
    throw new Error("Bedrock image content must include base64 data.");
  }

  private mapBase64Image(base64: string, mimeType: string): ImageBlock {
    return {
      format: this.imageFormat(mimeType),
      source: { bytes: decodeBase64(base64) },
    };
  }

  private imageFormat(mimeType: string): ImageFormat {
    switch (mimeType.toLowerCase()) {
      case "image/jpeg":
      case "image/jpg":
        return "jpeg";
      case "image/png":
        return "png";
      case "image/gif":
        return "gif";
      case "image/webp":
        return "webp";
      default:
        throw new Error(
          `Bedrock Converse does not support image MIME type "${mimeType}".`,
        );
    }
  }

  private mapTools(messages: LangMessages): Tool[] | undefined {
    if (!messages.availableTools?.length) return undefined;

    const tools: Tool[] = messages.availableTools.map(tool => {
      if (!isHandlerTool(tool)) {
        throw new Error(
          `Bedrock tool "${tool.name}" must define description, parameters, and a handler.`,
        );
      }
      return {
        toolSpec: {
          name: tool.name,
          description: tool.description,
          inputSchema: { json: tool.parameters },
        },
      };
    });
    return tools;
  }

  private mapOutputSchema(schema: NonNullable<LangOptions["schema"]>) {
    const jsonSchema = isZodSchema(schema)
      ? zodToJsonSchema(schema)
      : schema;
    return {
      textFormat: {
        type: "json_schema" as const,
        structure: {
          jsonSchema: {
            name: "response_schema",
            schema: JSON.stringify(jsonSchema),
          },
        },
      },
    };
  }
}

function isHandlerTool(tool: {
  name: string;
  [key: string]: unknown;
}): tool is LangToolWithHandler {
  return (
    typeof tool.description === "string" &&
    tool.parameters !== null &&
    typeof tool.parameters === "object" &&
    typeof tool.handler === "function"
  );
}

function unsupportedMessageItem(
  role: LangMessageRole,
  itemType: LangMessageItem["type"],
): Error {
  return new Error(
    `Bedrock cannot represent a "${itemType}" item in a "${role}" message.`,
  );
}

type JsonDocument =
  | null
  | boolean
  | number
  | string
  | JsonDocument[]
  | { [key: string]: JsonDocument };

function toJsonDocument(value: unknown): JsonDocument {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(
      "Bedrock tool results must be JSON-serializable.",
    );
  }
  if (serialized === undefined) {
    throw new Error(
      "Bedrock tool results must be JSON-serializable.",
    );
  }
  return JSON.parse(serialized) as JsonDocument;
}

function decodeBase64(base64: string): Uint8Array {
  const atobFunction = globalThis.atob;
  if (typeof atobFunction !== "function") {
    throw new Error(
      "This runtime cannot decode base64 images for Bedrock Converse.",
    );
  }

  let binary: string;
  try {
    binary = atobFunction(base64);
  } catch {
    throw new Error("Bedrock image content contains invalid base64 data.");
  }
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
