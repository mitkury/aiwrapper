import { Jsonic } from "jsonic";

/**
 * Gets something that resembles JSON from a string by finding the first "{" and the last "}" or the first "[" and the last "]".
 * @param str 
 * @returns string or null if failed to extract.
 */
function tryToGetJSONFromText(str: string): string | null {
  let startIndex = -1;
  let endIndex = -1;
  let expectedClosingBracket;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{') {
      expectedClosingBracket = '}';
      startIndex = i;
      break;
    }

    if (str[i] === '[') {
      expectedClosingBracket = ']';
      startIndex = i;
      break;
    }
  }

  if (expectedClosingBracket === undefined) {
    return null;
  }

  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] === expectedClosingBracket) {
      endIndex = i;
      break;
    }

    if (i === 0) {
      return null;
    }
  }

  if (startIndex === -1 || endIndex === -1) {
    return null;
  }

  return str.slice(startIndex, endIndex + 1);
}

/**
 * Tries to extract JSON from a string.
 * Uses a strict JSON parser first, if it fails, tries to use "jsonic" which allows for more relaxed JSON syntax.
 * @param str JSON along with other text
 * @returns returns an object or null if failed to extract.
 */
export default function extractJSON(
  str: string,
  verbose = false,
): object | null {
  const possilbeJsonStr = tryToGetJSONFromText(str);
  if (possilbeJsonStr === null) {
    if (verbose) {
      console.error("Failed to extract JSON from the string: " + str);
    }
    return null;
  }

  let jsonObj;

  try {
    // First try to parse it with a strict JSON parser
    jsonObj = JSON.parse(possilbeJsonStr);
  } catch {
    if (verbose) {
      console.error("Failed to parse JSON");
      console.log(possilbeJsonStr);
      console.log(
        "Will try to parse it with a less strict JSON parser (jsonic)",
      );
    }

    try {
      // If it fails, try to parse it with a less strict JSON parser
      jsonObj = Jsonic(possilbeJsonStr);
    } catch {
      if (verbose) {
        console.error("Failed to parse JSON with jsonic as well.");
      }
      jsonObj = null;
    }
  }

  return jsonObj;
}
