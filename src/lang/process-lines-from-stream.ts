export interface StreamParserState {
  currentEvent?: string;
}

const processLinesFromStream = (
  rawData: string,
  onData: (data: any) => void,
  state: StreamParserState = {},
) => {
  for (const rawLine of rawData.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(":")) continue;

    if (line.startsWith("event:")) {
      state.currentEvent = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("id:") || line.startsWith("retry:")) continue;

    if (line.startsWith("data:")) {
      const dataText = line.slice("data:".length).trimStart();
      if (!dataText) continue;
      if (dataText === "[DONE]") {
        onData({ finished: true });
        state.currentEvent = undefined;
        continue;
      }

      dispatchJSON(dataText, onData, state);
      state.currentEvent = undefined;
      continue;
    }

    dispatchJSON(line, onData, state);
    state.currentEvent = undefined;
  }
};

function dispatchJSON(
  text: string,
  onData: (data: any) => void,
  state: StreamParserState,
): void {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("Invalid streamed JSON data.", { cause: error });
  }

  if (
    state.currentEvent
    && typeof data === "object"
    && data !== null
    && !("type" in data)
  ) {
    data.type = state.currentEvent;
  }
  onData(data);
}

export default processLinesFromStream;
