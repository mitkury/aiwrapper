const processLinesFromStream = (rawData: string, onData: (data: any) => void) => {
  // Check if it's a JSON response
  if (rawData.startsWith("{")) {
    processDataAsJson(rawData, onData);
    return;
  }

  processDataAsStr(rawData, onData);
};

const processDataAsStr = (rawData: string, onData: (data: any) => void) => {
  const lines = rawData.split("\n");
  let currentEvent: string | null = null;
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.substring(7).trim();
      continue;
    }
    if (line.startsWith("data: ")) {
      const dataStr = line.substring(6);
      // @TODO: at the moment it's OpenAI specific. Make it generic.
      if (dataStr === "[DONE]") {
        onData({ finished: true });
        currentEvent = null;
        continue;
      }

      try {
        const data = JSON.parse(dataStr);
        if (currentEvent && typeof data === 'object' && data !== null && !('type' in data)) {
          (data as any).type = currentEvent;
        }
        onData(data);
      } catch (err) {
        throw new Error(err as any);
      } finally {
        currentEvent = null;
      }
    }
  }
}

const processDataAsJson = (rawData: string, onData: (data: any) => void) => {
  const lines = rawData.split("\n");
  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      onData(data);
    } catch (err) {
      throw new Error(err);
    }
  }
}

export default processLinesFromStream;
