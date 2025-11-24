// Agent state
export type AgentState = "idle" | "running";

// Core built-in event types
export interface AgentFinishedEvent<TOutput> {
  type: "finished";
  output: TOutput;
}

export interface AgentErrorEvent {
  type: "error";
  error: Error;
}

export interface AgentAbortedEvent<TOutput> {
  type: "aborted";
  error: Error;
  partial?: TOutput;
}

export interface AgentStateEvent {
  type: "state";
  state: AgentState;
}

// Base for custom events that agents can define
export interface AgentCustomEvent<TType extends string, TData = any> {
  type: TType;
  data: TData;
}

// Union of all possible agent events - extensible for custom events
export type AgentEvent<TOutput, TCustomEvents = never> = 
  | AgentFinishedEvent<TOutput>
  | AgentErrorEvent
  | AgentAbortedEvent<TOutput>
  | AgentStateEvent
  | TCustomEvents;

export type AgentEventListener<TOutput, TCustomEvents = never> = (event: AgentEvent<TOutput, TCustomEvents>) => void;

// Base class for all agents that defines what the agent allows to input and output
export abstract class Agent<TInput, TOutput, TCustomEvents = never> {
  private listeners: AgentEventListener<TOutput, TCustomEvents>[] = [];
  private _state: AgentState = "idle";

  // Get current agent state
  get state(): AgentState {
    return this._state;
  }

  // Subscribe to agent events
  subscribe(listener: AgentEventListener<TOutput, TCustomEvents>): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  // Run the agent either with a new input or the provided in this.lastInput
  async run(input?: TInput, options?: { signal?: AbortSignal }): Promise<TOutput> {
    this.setState("running");

    try {      
      const result = await this.runInternal(input, options);
      this.setState("idle");
      return result;
    } catch (error) {
      if ((error as any)?.name === "AbortError") {
        const partial = (error as any)?.partialResult as TOutput | undefined;
        this.emit({ type: "aborted", error: error as Error, partial });
        this.setState("idle");
        if (partial !== undefined) return partial;
        throw error;
      }

      this.emit({ type: "error", error: error as Error });
      this.setState("idle");
      throw error;
    }
  }

  // Set state and emit state change event
  private setState(newState: AgentState) {
    if (this._state !== newState) {
      this._state = newState;
      this.emit({ type: "state", state: newState });
    }
  }

  // Emit events to all listeners
  protected emit(event: AgentEvent<TOutput, TCustomEvents>) {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in agent event listener:", error);
      }
    });
  }

  // Abstract method to be implemented by concrete agents
  protected abstract runInternal(input?: TInput, options?: { signal?: AbortSignal }): Promise<TOutput>;
}
