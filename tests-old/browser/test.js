import { Lang } from '../../dist/npm-entry.js';

// Define and expose the test function
export async function runTest(apiKey) {
    const result = document.getElementById('result');
    try {
        const lang = Lang.openai({ 
            apiKey: apiKey,
            model: 'gpt-4'
        });
        result.textContent = 'OpenAI provider initialized successfully';
        return true;
    } catch (error) {
        result.textContent = `Error: ${error.message}`;
        return false;
    }
} 