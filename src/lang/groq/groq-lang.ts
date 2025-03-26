import { OpenAILikeLang } from "../openai-like/openai-like-lang.ts";
import { models } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import { 
  LangChatMessages, 
  LangResultWithMessages 
} from "../language-provider.ts";

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
    messages: LangChatMessages,
    onResult?: (result: LangResultWithMessages) => void,
  ): Promise<LangResultWithMessages> {
    // Initialize the result
    const result = new LangResultWithMessages(messages);
    const transformedMessages = this.transformMessages(messages);
    
    // Get the model info and check if it can reason
    const modelInfo = models.id(this._config.model);
    const isReasoningModel = modelInfo?.canReason() || false;
    
    const bodyProperties = {
      ...this._config.bodyProperties
    };
    
    // Only add reasoning_format for reasoning models
    if (isReasoningModel && !bodyProperties.reasoning_format) {
      bodyProperties.reasoning_format = "parsed";
    }
    
    // For non-streaming calls
    if (!onResult) {
      // Make a direct API call
      const body = {
        ...this.transformBody({
          model: this._config.model,
          messages: transformedMessages,
          stream: false,
          max_tokens: this._config.maxTokens || 4000,
        }),
        ...bodyProperties
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
      
      const data = await response.json();
      
      if (data.choices && data.choices.length > 0) {
        const message = data.choices[0].message;
        
        // Handle parsed format reasoning and content
        if (message.reasoning) {
          result.thinking = message.reasoning;
          result.answer = message.content || "";
        } else {
          // Handle raw format if that was requested
          result.answer = message.content || "";
          
          // Extract thinking from raw format
          // Do this even if model isn't identified as a reasoning model 
          // to handle cases where our model data is outdated
          const thinkingContent = this.extractThinking(result.answer);
          if (thinkingContent.thinking) {
            result.thinking = thinkingContent.thinking;
            result.answer = thinkingContent.answer;
          }
        }
        
        // Add to messages
        result.messages = [...messages, {
          role: "assistant",
          content: result.answer,
        }];
      }
      
      return result;
    }
    
    // For streaming
    let thinkingContent = "";
    let visibleContent = "";
    
    const onData = (data: any) => {
      if (data.finished) {
        // When streaming is complete, do one final extraction
        // regardless of model reasoning capability in our database
        const extracted = this.extractThinking(visibleContent);
        if (extracted.thinking) {
          result.thinking = extracted.thinking;
          result.answer = extracted.answer;
        }
        
        result.finished = true;
        onResult?.(result);
        return;
      }
      
      if (data.choices !== undefined) {
        const delta = data.choices[0].delta || {};
        
        // For parsed reasoning format
        if (delta.reasoning) {
          thinkingContent += delta.reasoning;
          result.thinking = thinkingContent;
        }
        
        // Handle content
        if (delta.content) {
          visibleContent += delta.content;
          
          // Always try to extract thinking on each update
          // This handles cases where model capabilities aren't up-to-date in our database
          const extracted = this.extractThinking(visibleContent);
          if (extracted.thinking) {
            result.thinking = extracted.thinking;
            result.answer = extracted.answer;
          } else {
            // If no thinking tags found, just use the content directly
            result.answer = visibleContent;
          }
        }
        
        // Update messages
        result.messages = [...messages, {
          role: "assistant",
          content: result.answer,
        }];
        
        onResult?.(result);
      }
    };
    
    // Call the API with streaming
    const streamingBody = {
      ...this.transformBody({
        model: this._config.model,
        messages: transformedMessages,
        stream: true,
        max_tokens: this._config.maxTokens || 4000,
      }),
      ...bodyProperties
    };
    
    await this.callAPI("/chat/completions", streamingBody, onData);
    
    return result;
  }
  
  // Simple helper to extract thinking content from raw format
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
  
  // Helper method to call the API
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
  
  // Process the response stream
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
        
        // Process complete lines
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
      
      // Process any remaining buffer content
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
