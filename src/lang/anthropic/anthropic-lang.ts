import {
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processServerEvents } from "../../process-server-events.ts";
import {
  LangMessage,
  LangOptions,
  LanguageProvider,
} from "../language-provider.ts";
import { models } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import {
  LangMessageItemImage,
  LangMessageItemText,
  LangMessageItemTool,
  LangMessageItemToolResult,
  LangMessages,
  LangTool,
} from "../messages.ts";
import { addInstructionAboutSchema } from "../prompt-for-json.ts";
import { AnthropicStreamHandler } from "./anthropic-stream-handler.ts";

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
    const modelName = options.model || "claude-3-7-sonnet-20250219";
    super(modelName);

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
    if (this._config.systemPrompt) {
      messages.instructions = this._config.systemPrompt;
    }
    messages.addUserMessage(prompt);
    return await this.chat(messages, options);
  }

  async chat(
    messages: LangMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messageCollection = messages instanceof LangMessages
      ? messages
      : new LangMessages(messages);

    let instructions = messageCollection.instructions || '';
    if (!instructions && this._config.systemPrompt) {
      instructions = this._config.systemPrompt;
    }

    if (options?.schema) {
      const baseInstruction = instructions !== '' ? instructions + '\n\n' : '';
      instructions = baseInstruction + addInstructionAboutSchema(
        options.schema
      );
    }

    const { providerMessages, requestMaxTokens, tools } =
      this.prepareRequest(messageCollection);

    const result = messageCollection;

    const requestBody: any = {
      model: this._config.model,
      messages: providerMessages,
      max_tokens: requestMaxTokens,
      system: instructions,
      // Always stream internally to unify the code path
      stream: true,
      ...(tools ? { tools } : {}),
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "x-api-key": this._config.apiKey
      },
      body: JSON.stringify(requestBody),
    } as any).catch((err) => { throw new Error(err); });

    const streamHandler = new AnthropicStreamHandler(result, options?.onResult);

    await processServerEvents(response, (data: any) => {
      streamHandler.handleEvent(data);
    });

    result.finished = true;

    // Automatically execute tools if the assistant requested them
    const toolResults = await result.executeRequestedTools();
    if (options?.onResult && toolResults) options.onResult(toolResults);

    return result;
  }

  private prepareRequest(messageCollection: LangMessages) {
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
    if (messageCollection.availableTools?.length) {
      const structuredTools = messageCollection.availableTools.filter(
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
        const forwardedImages = pendingAssistantImages.length > 0;
        for (const image of pendingAssistantImages) {
          this.appendImageBlocks(content, image);
        }
        pendingAssistantImages.length = 0;

        const { blocks: userBlocks, hasImages: userHasImages } = this.mapUserMessageItems(message);
        content.push(...userBlocks);

        if (forwardedImages || userHasImages) {
          content.push({ type: "text", text: this.getVisionHintText() });
        }

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

  private mapUserMessageItems(message: LangMessage): { blocks: any[]; hasImages: boolean } {
    const blocks: any[] = [];
    let hasImages = false;
    for (const item of message.items) {
      if (item.type === "text") {
        const textItem = item as LangMessageItemText;
        if (textItem.text.length > 0) {
          blocks.push({ type: "text", text: textItem.text });
        }
      } else if (item.type === "image") {
        hasImages = true;
        this.appendImageBlocks(blocks, item as LangMessageItemImage);
      }
    }
    return { blocks, hasImages };
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
      if (typeof content !== "string") {
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

  private getVisionHintText(): string {
    return "Describe the visual details of the image, including the subject's fur color and explicitly name the surface or object it is on (for example, a table).";
  }
}
