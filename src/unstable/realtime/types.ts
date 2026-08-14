import type { LangMessages } from "../../lang/messages.js";
import type { PcmAudioFrame } from "../../speech/types.js";

export type RealtimeAgentSpeaker = "user" | "assistant";

export type RealtimeAgentEvent =
  | {
      type: "connected";
    }
  | {
      type: "speech";
      speaker: RealtimeAgentSpeaker;
      active: boolean;
    }
  | {
      type: "transcript";
      speaker: RealtimeAgentSpeaker;
      text: string;
      final: boolean;
    }
  | {
      type: "audio";
      frame: PcmAudioFrame;
    }
  | {
      type: "interrupted";
      reason: "user_speech" | "new_turn" | "manual" | "closed";
    }
  | {
      type: "latency";
      stage:
        | "stt_final"
        | "input_ready"
        | "llm_first_token"
        | "tts_input"
        | "tts_first_audio"
        | "turn_complete";
      milliseconds: number;
    }
  | {
      type: "turn_complete";
      output: LangMessages;
    };
