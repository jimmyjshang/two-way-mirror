/**
 * EXAMPLE: Claude API plugin for Two-Way Mirror.
 *
 * This is a starting point — not a finished product.
 * Shows how to wire up the Claude API as a backend for either pane.
 *
 * To use:
 *   1. npm install @anthropic-ai/sdk
 *   2. Set your API key (env var or hardcode for testing)
 *   3. Import this in extension.js and assign to PANE_A_PLUGIN or PANE_B_PLUGIN
 */

// const Anthropic = require('@anthropic-ai/sdk');

const claudePlugin = {
  name: 'claude',

  // Set your own system prompt here
  systemPrompt: 'You are a helpful coding assistant.',

  onUserMessage: async (text, { history }) => {
    // Convert history to Claude message format
    const messages = history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.text
    }));

    // Uncomment and configure:
    //
    // const client = new Anthropic();
    // const response = await client.messages.create({
    //   model: 'claude-sonnet-4-20250514',
    //   max_tokens: 1024,
    //   system: claudePlugin.systemPrompt,
    //   messages
    // });
    // return response.content[0].text;

    return `(Claude plugin not configured yet — received: ${text})`;
  }
};

/**
 * EXAMPLE: Observer plugin that uses Claude to review Pane A's activity.
 *
 * This is the "mirror" side — it reads Pane A's event history
 * and uses Claude to provide commentary/review.
 */
const claudeObserverPlugin = {
  name: 'claude-observer',

  systemPrompt: `You are a senior engineer observing a coding session.
You can see everything the user and their AI assistant are doing.
When the user asks you a question, answer based on what you've observed.
Be direct and concise.`,

  onUserMessage: async (text, { eventBus, history }) => {
    // Get everything that happened in Pane A
    const paneAEvents = eventBus.getHistory({ pane: 'a' });

    // Build a summary of Pane A activity for context
    const activitySummary = paneAEvents.map(e => {
      if (e.type === 'user-message') return `User: ${e.data.text}`;
      if (e.type === 'agent-response') return `Agent: ${e.data.text}`;
      if (e.type === 'tool-call') return `[Tool: ${e.data.tool}]`;
      return `[${e.type}]`;
    }).join('\n');

    // Build messages for Claude
    const messages = [
      {
        role: 'user',
        content: `Here is the activity from the coding session I'm observing:\n\n${activitySummary}\n\nMy question: ${text}`
      }
    ];

    // Uncomment and configure:
    //
    // const client = new Anthropic();
    // const response = await client.messages.create({
    //   model: 'claude-sonnet-4-20250514',
    //   max_tokens: 1024,
    //   system: claudeObserverPlugin.systemPrompt,
    //   messages
    // });
    // return response.content[0].text;

    return `(Observer not configured — Pane A has ${paneAEvents.length} events. You asked: ${text})`;
  }
};

module.exports = { claudePlugin, claudeObserverPlugin };
