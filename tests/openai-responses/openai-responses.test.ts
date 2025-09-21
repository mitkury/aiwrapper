import { describe, it, expect } from 'vitest';
import { Lang, LangMessages, LangOptions } from '../../dist/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const run = !!apiKey;

describe.skipIf(!run)('OpenAI Responses', () => {
  
  // @TODO: add test for responses with existing response id and without it
  
});