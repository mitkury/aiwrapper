import { LangOptions, LangResult, LanguageProvider, LangContentPart, LangMessage } from "../language-provider.ts";
import { LangMessages } from "../messages.ts";
import { httpRequestWithRetry as fetch } from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { models, Model } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

export type OllamaLangOptions = {
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  url?: string;
};

export type OllamaLangConfig = {
  model: string;
  systemPrompt: string;
  maxTokens?: number;
  baseURL: string;
};

export class OllamaLang extends LanguageProvider {
  protected _config: OllamaLangConfig;
  protected modelInfo?: Model;

  constructor(options: OllamaLangOptions) {
    const modelName = options.model || "llama2:latest";
    super(modelName);
    
    this._config = {
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: options.url || "http://localhost:11434",
    };
    
    // Try to get model info from aimodels
    this.modelInfo = models.id(modelName);
    
    // Print a warning if model is not in database, but don't block execution
    // This allows users to use any Ollama model, even if it's not in our database
    if (!this.modelInfo) {
      //console.error(`Invalid Ollama model: ${modelName}. Model not found in aimodels database.`);
    }
  }

  protected transformBody(body: Record<string, unknown>): Record<string, unknown> {
    // Ollama uses context_length instead of max_tokens
    if (body.max_tokens) {
      const { max_tokens, ...rest } = body;
      return {
        ...rest,
        context_length: max_tokens
      };
    }
    return body;
  }

  async ask(
    prompt: string,
    options?: LangOptions,
  ): Promise<LangResult> {
    // Create a proper message collection
    const messages = new LangMessages();
    messages.addUserMessage(prompt);
    
    const result = new LangResult(messages);

    // Try to get model info and calculate max tokens
    let requestMaxTokens = this._config.maxTokens;

    if (this.modelInfo) {
      requestMaxTokens = calculateModelResponseTokens(
        this.modelInfo,
        [{ role: "user", content: prompt }],
        this._config.maxTokens
      );
    }

    // Variables to track streaming state for thinking extraction
    let visibleContent = "";
    let openThinkTagIndex = -1;
    let pendingThinkingContent = "";
    
    const onResult = options?.onResult;
    const onData = (data: any) => {
      if (data.done) {
        // Final check for thinking content when streaming is complete
        const extracted = this.extractThinking(visibleContent);
        if (extracted.thinking) {
          result.appendToAssistantThinking(extracted.thinking);
          const msg = result.ensureAssistantTextMessage();
          msg.content = extracted.answer;
        }
        
        result.finished = true;
        const last = result.length > 0 ? result[result.length - 1] : undefined;
        if (last) options?.onResult?.(last as any);
        return;
      }

      if (data.response) {
        const currentChunk = data.response;
        visibleContent += currentChunk;
        
        // Process the chunk for potential thinking content
        this.processChunkForThinking(currentChunk, visibleContent, result, openThinkTagIndex, pendingThinkingContent);
        
        // Update tracking variables based on current state
        openThinkTagIndex = visibleContent.lastIndexOf("<think>");
        if (openThinkTagIndex !== -1) {
          const closeTagIndex = visibleContent.indexOf("</think>", openThinkTagIndex);
          if (closeTagIndex === -1) {
            // We have an open tag but no close tag yet
            pendingThinkingContent = visibleContent.substring(openThinkTagIndex + 7); // +7 to skip "<think>"
          }
        }
      }

      const last = result.length > 0 ? result[result.length - 1] : undefined;
      if (last) options?.onResult?.(last as any);
    };

    const response = await fetch(`${this._config.baseURL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this._config.model,
        prompt,
        stream: true,
        ...(requestMaxTokens && { num_predict: requestMaxTokens })
      }),
    })
      .catch((err) => {
        throw new Error(err);
      });

    await processResponseStream(response, onData);
    
    // For non-streaming case, perform final extraction
    if (!onResult) {
      const extracted = this.extractThinking(result.answer);
      if (extracted.thinking) {
        result.appendToAssistantThinking(extracted.thinking);
        const msg = result.ensureAssistantTextMessage();
        msg.content = extracted.answer;
      }
    }

    return result;
  }

  async chat(messages: LangMessage[] | LangMessages, options?: LangOptions): Promise<LangResult> {
    const result = new LangResult(messages);

    // Try to get model info and calculate max tokens
    let requestMaxTokens = this._config.maxTokens;

    if (this.modelInfo) {
      requestMaxTokens = calculateModelResponseTokens(
        this.modelInfo,
        messages,
        this._config.maxTokens
      );
    }

    // Variables to track streaming state for thinking extraction
    let visibleContent = "";
    let openThinkTagIndex = -1;
    let pendingThinkingContent = "";
    
    const onResult = options?.onResult;
    const onData = (data: any) => {
      if (data.done) {
        // Final check for thinking content when streaming is complete
        const extracted = this.extractThinking(visibleContent);
        if (extracted.thinking) {
          result.appendToAssistantThinking(extracted.thinking);
          const msg = result.ensureAssistantTextMessage();
          msg.content = extracted.answer;
        }
        
        result.finished = true;
        const last = result.length > 0 ? result[result.length - 1] : undefined;
        if (last) options?.onResult?.(last as any);
        return;
      }

      if (data.message && data.message.content) {
        const currentChunk = data.message.content;
        visibleContent += currentChunk;
        
        // Process the chunk for potential thinking content
        this.processChunkForThinking(currentChunk, visibleContent, result, openThinkTagIndex, pendingThinkingContent);
        
        // Update tracking variables based on current state
        openThinkTagIndex = visibleContent.lastIndexOf("<think>");
        if (openThinkTagIndex !== -1) {
          const closeTagIndex = visibleContent.indexOf("</think>", openThinkTagIndex);
          if (closeTagIndex === -1) {
            // We have an open tag but no close tag yet
            pendingThinkingContent = visibleContent.substring(openThinkTagIndex + 7); // +7 to skip "<think>"
          }
        }
      }

      const last = result.length > 0 ? result[result.length - 1] : undefined;
      if (last) options?.onResult?.(last as any);
    };

    // Extract base64 images for models that support vision via images array.
    const images: string[] = [];
    const mappedMessages = messages.map((m: any) => {
      if (Array.isArray(m.content)) {
        for (const part of m.content as LangContentPart[]) {
          if (part.type === 'image') {
            const img: any = part.image;
            if (img.kind === 'base64') images.push(img.base64);
            if (img.kind === 'url' && typeof img.url === 'string' && img.url.startsWith('data:')) {
              const match = img.url.match(/^data:([^;]+);base64,(.*)$/);
              if (match) images.push(match[2]);
            }
          }
        }
        // Replace structured parts with concatenated text for message content
        const text = (m.content as LangContentPart[])
          .filter(p => p.type === 'text')
          .map(p => (p as any).text)
          .join('\n');
        return { role: m.role, content: text };
      }
      return m;
    });

    const response = await fetch(`${this._config.baseURL}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model: this._config.model,
        messages: mappedMessages,
        ...(images.length > 0 ? { images } : {}),
        stream: true,
        ...(requestMaxTokens && { num_predict: requestMaxTokens }),
      })
    })
      .catch((err) => {
        throw new Error(err);
      });

    await processResponseStream(response, onData);
    
    // For non-streaming case, perform final extraction
    if (!onResult) {
      const extracted = this.extractThinking(result.answer);
      if (extracted.thinking) {
        result.appendToAssistantThinking(extracted.thinking);
        const msg = result.ensureAssistantTextMessage();
        msg.content = extracted.answer;
      }
    }

    return result;
  }
  
  // Helper to extract thinking content from <think> tags
  private extractThinking(content: string): { thinking: string, answer: string } {
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    const matches = content.match(thinkRegex);
    
    if (!matches || matches.length === 0) {
      return { thinking: "", answer: content };
    }
    
    // Extract thinking content
    const thinking = matches
      .map((match: string) => match.replace(/<think>|<\/think>/g, "").trim())
      .join("\n");
    
    // Remove thinking tags for clean answer
    const answer = content.replace(thinkRegex, "").trim();
    
    return { thinking, answer };
  }
  
  // Process a chunk for thinking content during streaming
  private processChunkForThinking(
    currentChunk: string, 
    fullContent: string, 
    result: LangMessages,
    openTagIndex: number,
    pendingThinking: string
  ): void {
    // Check if we have a complete thinking section
    const extracted = this.extractThinking(fullContent);
    
    if (extracted.thinking) {
      // We have one or more complete thinking sections
      result.appendToAssistantThinking(extracted.thinking);
      const msg = result.ensureAssistantTextMessage();
      msg.content = extracted.answer;
      return;
    }
    
    // Check for partial thinking tags
    if (fullContent.includes("<think>")) {
      // We have at least an opening tag
      const lastOpenTagIndex = fullContent.lastIndexOf("<think>");
      const firstCloseTagIndex = fullContent.indexOf("</think>");
      
      if (firstCloseTagIndex === -1 || lastOpenTagIndex > firstCloseTagIndex) {
        // We have an open tag without a closing tag
        // Everything from the open tag to the end should be considered thinking
        const beforeThinkingContent = fullContent.substring(0, lastOpenTagIndex).trim();
        const potentialThinkingContent = fullContent.substring(lastOpenTagIndex + 7).trim();
        
        result.appendToAssistantThinking(potentialThinkingContent);
        const msg = result.ensureAssistantTextMessage();
        msg.content = beforeThinkingContent;
        return;
      }
      
      // If we have both tags but the regex didn't match (shouldn't happen but just in case)
      // Extract the content manually
      const startIndex = fullContent.indexOf("<think>") + 7;
      const endIndex = fullContent.indexOf("</think>");
      if (startIndex < endIndex) {
        const thinkingContent = fullContent.substring(startIndex, endIndex).trim();
        const beforeThinking = fullContent.substring(0, fullContent.indexOf("<think>")).trim();
        const afterThinking = fullContent.substring(fullContent.indexOf("</think>") + 8).trim();
        
        result.appendToAssistantThinking(thinkingContent);
        const msg = result.ensureAssistantTextMessage();
        msg.content = (beforeThinking + " " + afterThinking).trim();
      }
    } else {
      // No thinking tags yet, just update the answer
      const msg = result.ensureAssistantTextMessage();
      msg.content = fullContent;
    }
  }
}
