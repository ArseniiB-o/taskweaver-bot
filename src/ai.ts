import OpenAI from 'openai';
import { buildActionCatalog } from './actions/registry.js';
import type { ExecutionPlan } from './actions/types.js';

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

const SYSTEM_PROMPT = `You are a task planner for a file/media processing bot. Users send you requests (with or without files) and you must create an execution plan using available actions.

${buildActionCatalog()}

## RULES:
1. Analyze the user's request and determine which actions to use
2. If the request requires multiple steps, chain them in order
3. If a step needs output from a previous step, set useOutputFrom to that step's index (0-based)
4. Parameters must match the action's param definitions
5. If files are attached, actions will automatically receive them as inputFiles
6. If no action matches the request, set steps to empty array and explain in message
7. For text-based params (like text, data, expression), extract values from the user's message
8. Prefer simpler plans with fewer steps when possible
9. The message field should be a short Russian description of what will be done

## RESPONSE FORMAT (JSON only, no markdown):
{
  "steps": [
    { "action": "action.id", "params": { "param1": "value1" }, "useOutputFrom": null },
    { "action": "action.id", "params": {}, "useOutputFrom": 0 }
  ],
  "message": "Описание того, что будет сделано"
}

IMPORTANT: Respond with ONLY valid JSON. No markdown code blocks, no explanation text outside JSON.`;

export async function createPlan(
  userMessage: string,
  fileDescriptions: string[]
): Promise<ExecutionPlan> {
  const fileInfo = fileDescriptions.length > 0
    ? `\n\nAttached files: ${fileDescriptions.join(', ')}`
    : '';

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage + fileInfo },
    ],
    temperature: 0.1,
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content?.trim() || '';

  try {
    const cleaned = content
      .replace(/^```json?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    const plan = JSON.parse(cleaned) as ExecutionPlan;

    if (!Array.isArray(plan.steps)) {
      return { steps: [], message: 'Не удалось распознать запрос' };
    }

    return plan;
  } catch (e) {
    console.error('Failed to parse AI response:', content);
    return { steps: [], message: `Ошибка парсинга ответа AI: ${content.slice(0, 200)}` };
  }
}
