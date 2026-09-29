import {
  httpRequestWithRetry as fetch,
} from "../../http-request.js";
import { processServerEvents } from "../../process-server-events.js";
import {
  LanguageProvider,
} from "../language-provider.js";
import type { LangMessage, LangOptions } from "../language-provider.js";
import { models } from '../../aimodels/index.js';
import { calculateModelResponseTokens } from "../utils/token-calculator.js";
import { attachPartialResult, isAbortError } from "../../errors.js";
import {
  LangMessages,
  fixToolResultsIfNeeded,
  isLangToolResultContent,
  normalizeLangToolResultImage,
} from "../messages.js";
import type {
  LangMessageItemImage,
  LangMessageItemText,
  LangMessageItemTool,
  LangMessageItemToolResult,
  LangTool,
  LangToolResultPart,
} from "../messages.js";
import {
  addInstructionAboutSchema,
  combineInstructions,
} from "../prompt-for-json.js";
import { AnthropicStreamHandler } from "./anthropic-stream-handler.js";

type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, any>;
};

export type AnthropicLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  extendedThinking?: boolean;
  defaultOptions?: LangOptions;
};

export type AnthropicLangConfig = {
  apiKey: string;
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
  extendedThinking?: boolean;
};

export class AnthropicLang extends LanguageProvider {
  _config: AnthropicLangConfig;

  constructor(options: AnthropicLangOptions) {
    const modelName = options.model || "claude-sonnet-4-6";
    super(modelName, options.defaultOptions);

    const modelInfo = models.id(modelName);
    if (!modelInfo) {
      console.error(`Invalid Anthropic model: ${modelName}. Model not found in aimodels database.`);
    }

    this._config = {
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt,
      maxTokens: options.maxTokens,
      extendedThinking: options.extendedThinking,
    };
  }

  async ask(
    prompt: string,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messages = new LangMessages();
    messages.addUserMessage(prompt);
    return await this.chat(messages, options);
  }

  async chat(
    messages: LangMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const resolvedOptions = this.resolveOptions(options);
    const abortSignal = resolvedOptions?.signal;
    const messageCollection = this.beginRequest(
      messages instanceof LangMessages
        ? messages
        : new LangMessages(messages),
    );

    const instructions = combineInstructions(
      this._config.systemPrompt,
      messageCollection.instructions,
      resolvedOptions?.schema
        ? addInstructionAboutSchema(resolvedOptions.schema)
        : undefined,
    );

    fixToolResultsIfNeeded(messageCollection);

    const requestTools = this.resolveTools(messageCollection, resolvedOptions);
    const { providerMessages, requestMaxTokens, tools } =
      this.prepareRequest(messageCollection, requestTools);

    const result = messageCollection;

    const requestBody: any = {
      model: this._config.model,
      messages: providerMessages,
      max_tokens: requestMaxTokens,
      system: instructions,
      // Always stream internally to unify the code path
      stream: true,
      ...(tools ? { tools } : {}),
      ...(resolvedOptions?.providerSpecificBody ?? {}),
    };

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "x-api-key": this._config.apiKey,
          ...(resolvedOptions?.providerSpecificHeaders ?? {}),
        },
        body: JSON.stringify(requestBody),
        signal: abortSignal,
      });

      const streamHandler = new AnthropicStreamHandler(result, resolvedOptions?.onResult);

      await processServerEvents(response, (data: any) => {
        streamHandler.handleEvent(data);
      }, abortSignal);
    } catch (error) {
      if (isAbortError(error)) {
        result.aborted = true;
        throw attachPartialResult(error, result);
      }
      throw error;
    }

    result.finished = true;

    // Automatically execute tools if the assistant requested them
    const toolResults = await result.executeRequestedTools({
      tools: requestTools,
      signal: abortSignal,
    });
    if (resolvedOptions?.onResult && toolResults) resolvedOptions.onResult(toolResults);

    return result;
  }

  private prepareRequest(
    messageCollection: LangMessages,
    requestTools?: LangTool[],
  ) {
    const providerMessages = this.transformMessagesForProvider(messageCollection);

    const modelInfo = models.id(this._config.model);
    if (!modelInfo) {
      console.warn(`Model info not found for ${this._config.model}`);
    }

    const requestMaxTokens = modelInfo ? calculateModelResponseTokens(
      modelInfo,
      messageCollection,
      this._config.maxTokens
    ) : this._config.maxTokens || 16000;

    let tools: AnthropicTool[] | undefined;
    if (requestTools?.length) {
      const structuredTools = requestTools.filter(
        (tool): tool is LangTool & { description?: string; parameters: Record<string, any> } =>
          typeof (tool as any).parameters === "object" && (tool as any).parameters !== null
      );
      if (structuredTools.length > 0) {
        tools = structuredTools.map((tool) => ({
          name: tool.name,
          description: (tool as any).description || "",
          input_schema: (tool as any).parameters,
        }));
      }
    }

    return { providerMessages, requestMaxTokens, tools };
  }


  protected transformMessagesForProvider(messages: LangMessages): any[] {
    const out: any[] = [];
    const pendingAssistantImages: LangMessageItemImage[] = [];
    for (const message of messages) {
      if (message.role === "user") {
        const content: any[] = [];
        for (const image of pendingAssistantImages) {
          this.appendImageBlocks(content, image);
        }
        pendingAssistantImages.length = 0;

        content.push(...this.mapUserMessageItems(message));

        if (content.length > 0) {
          out.push({ role: "user", content });
        }
      } else if (message.role === "assistant") {
        const { content, imagesForNextUser } = this.mapAssistantMessageItems(message);
        if (content.length > 0) {
          out.push({ role: "assistant", content });
        }
        if (imagesForNextUser.length > 0) {
          pendingAssistantImages.push(...imagesForNextUser);
        }
      } else if (message.role === "tool-results") {
        const content = this.mapToolResultItems(message);
        if (content.length > 0) {
          out.push({ role: "user", content });
        }
      }
    }
    return out;
  }

  private mapUserMessageItems(message: LangMessage): any[] {
    const blocks: any[] = [];
    for (const item of message.items) {
      if (item.type === "text") {
        const textItem = item as LangMessageItemText;
        if (textItem.text.length > 0) {
          blocks.push({ type: "text", text: textItem.text });
        }
      } else if (item.type === "image") {
        this.appendImageBlocks(blocks, item as LangMessageItemImage);
      }
    }
    return blocks;
  }

  private mapAssistantMessageItems(message: LangMessage): { content: any[]; imagesForNextUser: LangMessageItemImage[] } {
    const blocks: any[] = [];
    const imagesForNextUser: LangMessageItemImage[] = [];
    for (const item of message.items) {
      switch (item.type) {
        case "text": {
          const textItem = item as LangMessageItemText;
          if (textItem.text.length > 0) {
            blocks.push({ type: "text", text: textItem.text });
          }
          break;
        }
        case "image": {
          imagesForNextUser.push(item as LangMessageItemImage);
          break;
        }
        case "tool": {
          const toolItem = item as LangMessageItemTool;
          blocks.push({
            type: "tool_use",
            id: toolItem.callId,
            name: toolItem.name,
            input: toolItem.arguments ?? {},
          });
          break;
        }
        case "reasoning":
          // Skip reasoning blocks when sending context back to Anthropic
          break;
      }
    }
    return { content: blocks, imagesForNextUser };
  }

  private mapToolResultItems(message: LangMessage): any[] {
    const blocks: any[] = [];
    for (const item of message.items) {
      if (item.type !== "tool-result") continue;
      const resultItem = item as LangMessageItemToolResult;
      let content: any = resultItem.result;
      if (isLangToolResultContent(content)) {
        if (content.content.length === 0) {
          throw new Error("Anthropic tool content must contain at least one part.");
        }
        content = content.content.map(part => this.mapToolResultPart(part));
      } else if (typeof content !== "string") {
        content = JSON.stringify(content ?? {});
      }
      blocks.push({
        type: "tool_result",
        tool_use_id: resultItem.callId,
        content,
      });
    }
    return blocks;
  }

  private mapToolResultPart(part: LangToolResultPart): any {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }

    const image = normalizeLangToolResultImage(part);
    if (image.kind === "url") {
      return {
        type: "image",
        source: { type: "url", url: image.url },
      };
    }

    return {
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType,
        data: image.base64,
      },
    };
  }

  private appendImageBlocks(target: any[], image: LangMessageItemImage): void {
    const imageBlock = this.mapImageItemToAnthropicImageBlock(image);
    if (imageBlock) {
      target.push(imageBlock);
    }
  }

  private mapImageItemToAnthropicImageBlock(image: LangMessageItemImage): any | null {
    if (typeof image.base64 === "string" && image.base64.length > 0) {
      const mediaType = image.mimeType || "image/png";
      return {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: image.base64 },
      };
    }

    if (typeof image.url === "string" && image.url.length > 0) {
      if (image.url.startsWith("data:")) {
        const match = image.url.match(/^data:([^;]+);base64,(.*)$/);
        if (!match) {
          console.warn("Invalid data URL for Anthropic image.");
          return null;
        }
        const media_type = match[1];
        const data = match[2];
        return {
          type: "image",
          source: { type: "base64", media_type, data },
        };
      }
      return {
        type: "image",
        source: { type: "url", url: image.url },
      };
    }

    return null;
  }
}
