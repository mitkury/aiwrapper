import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'dummy-key';

test('should initialize OpenAI provider in browser', async ({ page }) => {
  // Navigate to the page
  await page.goto('/');
  
  // Wait for the module to load and expose the test function
  await page.waitForFunction(() => window.runTest !== undefined);
  
  // Run the test with API key
  const testResult = await page.evaluate((apiKey) => {
    // @ts-ignore - runTest is loaded from test.js
    return window.runTest(apiKey);
  }, OPENAI_API_KEY);
  
  // Check the result
  expect(testResult).toBe(true);
  
  // Verify the success message
  const resultText = await page.textContent('#result');
  expect(resultText).toBe('OpenAI provider initialized successfully');
}); 