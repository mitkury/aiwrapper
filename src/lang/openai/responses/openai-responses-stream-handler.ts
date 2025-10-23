import { LangMessages, LangMessage } from "../../messages";

type OpenAIResponseItem = {
  id: string;
  type: string;
  // We link our messages to items so we can mutate them as items are updated
  targetMessage?: LangMessage;
  [key: string]: any;
}

/**
 * Stream response handler for the OpenAI Responses API
 */
export class OpenAIResponseStreamHandler {
  id: string;
  items: OpenAIResponseItem[];
  messages: LangMessages;
  onResult?: (result: LangMessage) => void;

  constructor(messages: LangMessages, onResult?: (result: LangMessage) => void) {
    this.items = [];
    this.messages = messages;
    this.onResult = onResult;
  }

  handleEvent(data: any) {
    if (!('type' in data)) {
      console.warn('Unknown data from server:', data);
      return;
    }

    if (!('type' in data)) {
      console.warn('Unknown data from server:', data);
      return;
    }

    switch (data.type) {
      case 'response.created':
        this.id = data.response.id;
        break;
      case 'response.output_item.added':
        this.addItem(data.item);
        break;
      case 'response.output_item.done':
        this.setItem(data.item);
        break;
      case 'response.content_part.added':
        break;
      case 'response.content_part.done':
        break;

      // Deltas that we care about (feel free to add more if you want to show them in-progress somewhere)
      case 'response.output_text.delta':
        //case 'response.function_call_arguments.delta':
        this.applyDelta(data.item_id, data.delta);
        break;
      case 'response.function_call_arguments.delta':
        this.applyArgsDelta(data.item_id, data.delta);
        break;
      case 'response.function_call_arguments.done':
        this.setArgs(data.item_id, data.arguments);
        break;
    }
  }

  /**
   * Examples of items that can come into this handler:
   * "type":"response.output_item.added","sequence_number":4,"output_index":1,"item":{"id":"fc_0d1fd1ec5aba34630068edbe1df02881a28c623f7dc5d45e81","type":"function_call","status":"in_progress","arguments":"","call_id":"call_Pc4gzmrkhNIdTYrySlALhyIl","name":"get_current_weather"}
   * "type":"response.output_item.done","sequence_number":18,"output_index":1,"item":{"id":"fc_0d1fd1ec5aba34630068edbe1df02881a28c623f7dc5d45e81","type":"function_call","status":"completed","arguments":"{\"location\":\"Boston, MA\",\"unit\":\"celsius\"}","call_id":"call_Pc4gzmrkhNIdTYrySlALhyIl","name":"get_current_weather"}
   * "type":"response.output_item.added","sequence_number":4,"output_index":1,"item":{"id":"msg_0dfe4783196ccc2e0068edc3874d5c81a3b2beb308e6eae8f3","type":"message","status":"in_progress","content":[],"role":"assistant"}
   * "type":"response.output_item.done","sequence_number":236,"output_index":1,"item":{"id":"msg_0dfe4783196ccc2e0068edc3874d5c81a3b2beb308e6eae8f3","type":"message","status":"completed","content":[{"type":"output_text","annotations":[],"logprobs":[],"text":"Hey!"}],"role":"assistant"}
   */
  setItem(target: OpenAIResponseItem) {
    const item = this.getItem(target.id);
    if (!target) {
      console.warn('Unknown item:', target);
      return;
    }

    switch (item.type) {
      case 'message':
        if (!item.targetMessage) {
          console.warn('Unknown target message for item:', target);
          return;
        }
        if (item.role === 'assistant') {
          for (const content of target.content) {
            if (content.type === 'output_text') {
              item.targetMessage.content = content.text as string;
            }
          }

          this.onResult?.(item.targetMessage);
        } else {
          console.warn('Unknown role:', item.role, 'for item:', item);
        }
        break;

      case 'function_call':
        const argsParsed = JSON.parse(target.arguments) as Record<string, any>;
        const callId = target.call_id;
        const name = target.name;

        this.messages.addAssistantToolCalls([
          {
            callId,
            name,
            arguments: argsParsed
          }
        ], { openaiResponseId: this.id });

        const msg = this.messages[this.messages.length - 1];
        this.onResult?.(msg);
        break;
      default:
        break;
    }
  }

  addItem(target: OpenAIResponseItem) {
    this.items.push(target);

    switch (target.type) {
      case 'message':

        if (target.role === 'assistant') {
          this.messages.addAssistantMessage(target.text ?? '');
          target.targetMessage = this.messages[this.messages.length - 1];
          // We set the openaiResponseId so we effectively respond to this message
          // without re-sending all of the previous messages (check how we prepare input for the API when we send messages)
          target.targetMessage.meta = { openaiResponseId: this.id };
          this.onResult?.(target.targetMessage);
        } else {
          console.warn('Unknown role:', target.role, 'for item:', target);
        }

        break;
      case 'function_call':

        if (typeof target.arguments !== 'string') {
          target.arguments = '';
        }

        break;
      default:
        break;
    }
  }

  getItem(id: string): OpenAIResponseItem | undefined {
    return this.items.find(r => r.id === id);
  }

  applyArgsDelta(itemId: string, delta: string) {
    const item = this.getItem(itemId);
    if (item && item.type === 'function_call') {
      if (typeof item.arguments !== 'string') item.arguments = '';
      item.arguments += delta;
    }
  }

  setArgs(itemId: string, args: string) {
    const item = this.getItem(itemId);
    if (item && item.type === 'function_call') {
      item.arguments = args;
    }
  }

  applyDelta(itemId: string, delta: any) {
    const item = this.getItem(itemId);
    if (item) {
      if (typeof delta === "string") {
        item.text += delta;
      }

      if (item.targetMessage) {
        if (typeof delta === "string") {
          item.targetMessage.content += delta;
        } else {
          // @TODO: handle other delta types
          console.warn('Unknown delta type:', typeof delta, 'for item:', item);
        }

        // This callback is reponsible for the real-time vizualizaiton of the model output.
        // So we can show the output being generated in UIs.
        this.onResult?.(item.targetMessage);
      }
    }
  }
}