import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";
import { models } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import { 
  LangChatMessageCollection, 
  LangOptions, 
  LangChatMessage
} from "../language-provider.ts";
import { LangMessages, ToolWithHandler } from "../messages.ts";

export type GroqLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  bodyProperties?: Record<string, any>;
};

export class GroqLang extends OpenAILikeLang {
  constructor(options: GroqLangOptions) {
    const modelName = options.model || "llama3-70b-8192";
    super({
      apiKey: options.apiKey,
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      baseURL: "https://api.groq.com/openai/v1",
      bodyProperties: options.bodyProperties || {},
      maxTokens: options.maxTokens,
    });
  }

  override async chat(
    messages: LangChatMessage[] | LangChatMessageCollection,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messageCollection = messages instanceof LangMessages
      ? messages as LangMessages
      : (messages instanceof LangChatMessageCollection ? new LangMessages(messages as any) : new LangMessages(messages as any));

    const modelInfo = models.id(this._config.model);
    const isReasoningModel = modelInfo?.canReason() || false;
    
    const bodyProperties = {
      ...this._config.bodyProperties
    };
    
    if (isReasoningModel && !bodyProperties.reasoning_format) {
      bodyProperties.reasoning_format = "parsed";
    }
    
    const onResult = options?.onResult;
    
    if (!onResult) {
      const effectiveTools: ToolWithHandler[] | undefined = messageCollection.availableTools
        ? (messageCollection.availableTools as ToolWithHandler[])
        : undefined;

      const body: any = {
        ...this.transformBody({
          model: this._config.model,
          messages: messageCollection,
          stream: false,
          max_tokens: this._config.maxTokens || 4000,
        }),
        ...bodyProperties,
        ...(effectiveTools ? { tools: this.formatTools(effectiveTools), tool_choice: 'required' } : {}),
      };
      
      const response = await fetch(`${this._config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this._config.apiKey ? { "Authorization": `Bearer ${this._config.apiKey}` } : {}),
          ...this._config.headers,
        },
        body: JSON.stringify(body),
      });
      
      const data: any = await response.json();
      
      if (data.choices && data.choices.length > 0) {
        const message = data.choices[0].message;
        const toolCalls = message?.tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          messageCollection.toolsRequested = [] as any;
          for (const tc of toolCalls) {
            const id: string = tc?.id || '';
            const name: string = tc?.function?.name || '';
            const rawArgs: string = tc?.function?.arguments || '';
            let parsedArgs: Record<string, unknown> = {};
            if (typeof rawArgs === 'string' && rawArgs.trim().length > 0) {
              try {
                parsedArgs = JSON.parse(rawArgs);
              } catch {}
            }
            (messageCollection.toolsRequested as any).push({ id, name, arguments: parsedArgs });
          }
        }

        if (message.reasoning) {
          messageCollection.thinking = message.reasoning;
          messageCollection.answer = message.content || "";
        } else {
          messageCollection.answer = message.content || "";
          const thinkingContent = this.extractThinking(messageCollection.answer);
          if (thinkingContent.thinking) {
            messageCollection.thinking = thinkingContent.thinking;
            messageCollection.answer = thinkingContent.answer;
          }
        }
        
        if (messageCollection.answer) {
          messageCollection.addAssistantMessage(messageCollection.answer);
        }
      }
      
      return messageCollection;
    }
    
    let thinkingContent = "";
    let visibleContent = "";
    let openThinkTagIndex = -1;
    let pendingThinkingContent = "";
    
    const onData = (data: any) => {
      if (data.finished) {
        const extracted = this.extractThinking(visibleContent);
        if (extracted.thinking) {
          messageCollection.thinking = extracted.thinking;
          messageCollection.answer = extracted.answer;
        }
        
        messageCollection.finished = true;
        options?.onResult?.(messageCollection as any);
        return;
      }
      
      if (data.choices !== undefined) {
        const delta = data.choices[0].delta || {};
        
        if (delta.reasoning) {
          thinkingContent += delta.reasoning;
          messageCollection.thinking = thinkingContent;
        }
        
        if (delta.content) {
          const currentChunk = delta.content;
          visibleContent += currentChunk;
          this.processChunkForThinking(visibleContent, messageCollection as any);
          openThinkTagIndex = visibleContent.lastIndexOf("<think>");
          if (openThinkTagIndex !== -1) {
            const closeTagIndex = visibleContent.indexOf("</think>", openThinkTagIndex);
            if (closeTagIndex === -1) {
              pendingThinkingContent = visibleContent.substring(openThinkTagIndex + 7);
            }
          }
        }
        
        messageCollection.answer = messageCollection.thinking ? messageCollection.answer : visibleContent;
        
        if (messageCollection.length > 0 && messageCollection[messageCollection.length - 1].role === "assistant") {
          messageCollection[messageCollection.length - 1].content = messageCollection.answer;
        } else {
          messageCollection.addAssistantMessage(messageCollection.answer);
        }
        
        options?.onResult?.(messageCollection as any);
      }
    };
    
    const streamingBody = {
      ...this.transformBody({
        model: this._config.model,
        messages: messages as any,
        stream: true,
        max_tokens: this._config.maxTokens || 4000,
      }),
      ...bodyProperties
    };
    
    await this.callAPI("/chat/completions", streamingBody, onData);
    
    return messageCollection;
  }
  
  private extractThinking(content: string): { thinking: string, answer: string } {
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    const matches = content.match(thinkRegex);
    
    if (!matches || matches.length === 0) {
      return { thinking: "", answer: content };
    }
    
    const thinking = matches
      .map((match: string) => match.replace(/<think>|<\/think>/g, "").trim())
      .join("\n");
    
    const answer = content.replace(thinkRegex, "").trim();
    
    return { thinking, answer };
  }
  
  private processChunkForThinking(
    fullContent: string, 
    result: LangMessages
  ): void {
    const extracted = this.extractThinking(fullContent);
    
    if (extracted.thinking) {
      result.thinking = extracted.thinking;
      result.answer = extracted.answer;
      return;
    }
    
    if (fullContent.includes("<think>")) {
      const lastOpenTagIndex = fullContent.lastIndexOf("<think>");
      const firstCloseTagIndex = fullContent.indexOf("</think>");
      
      if (firstCloseTagIndex === -1 || lastOpenTagIndex > firstCloseTagIndex) {
        const beforeThinkingContent = fullContent.substring(0, lastOpenTagIndex).trim();
        const potentialThinkingContent = fullContent.substring(lastOpenTagIndex + 7).trim();
        
        result.thinking = potentialThinkingContent;
        result.answer = beforeThinkingContent;
        return;
      }
      
      const startIndex = fullContent.indexOf("<think>") + 7;
      const endIndex = fullContent.indexOf("</think>");
      if (startIndex < endIndex) {
        const thinkingContent = fullContent.substring(startIndex, endIndex).trim();
        const beforeThinking = fullContent.substring(0, fullContent.indexOf("<think>")).trim();
        const afterThinking = fullContent.substring(fullContent.indexOf("</think>") + 8).trim();
        
        result.thinking = thinkingContent;
        result.answer = (beforeThinking + " " + afterThinking).trim();
      }
    } else {
      result.answer = fullContent;
    }
  }

  private async callAPI(endpoint: string, body: any, onData: (data: any) => void) {
    const response = await fetch(`${this._config.baseURL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this._config.apiKey ? { "Authorization": `Bearer ${this._config.apiKey}` } : {}),
        ...this._config.headers,
      },
      body: JSON.stringify(body),
    }).catch((err) => {
      throw new Error(err);
    });
    
    await this.processResponse(response, onData);
    
    return response;
  }
  
  private async processResponse(response: Response, onData: (data: any) => void) {
    const reader = response.body?.getReader();
    if (!reader) return;
    
    const decoder = new TextDecoder();
    let buffer = "";
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        let lineEnd = buffer.indexOf('\n');
        while (lineEnd !== -1) {
          const line = buffer.substring(0, lineEnd).trim();
          buffer = buffer.substring(lineEnd + 1);
          
          if (line.startsWith('data: ')) {
            const dataValue = line.substring(6);
            if (dataValue === '[DONE]') {
              onData({ finished: true });
            } else {
              try {
                const data = JSON.parse(dataValue);
                onData(data);
              } catch (e) {
                console.error("Error parsing JSON:", e);
              }
            }
          }
          
          lineEnd = buffer.indexOf('\n');
        }
      }
      
      if (buffer.trim() && buffer.startsWith('data: ')) {
        const dataValue = buffer.substring(6).trim();
        if (dataValue === '[DONE]') {
          onData({ finished: true });
        } else if (dataValue) {
          try {
            const data = JSON.parse(dataValue);
            onData(data);
          } catch (e) {
            console.error("Error parsing JSON:", e);
          }
        }
      }
      
      onData({ finished: true });
    } catch (e) {
      console.error("Error processing response stream:", e);
      throw e;
    } finally {
      reader.releaseLock();
    }
  }
}
