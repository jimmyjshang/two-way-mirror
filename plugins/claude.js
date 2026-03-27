/**
 * Claude Code Plugin — powers panes with real Claude Code sessions.
 *
 * Uses the Agent SDK's query() API with session resumption for multi-turn
 * conversations. The SDK handles binary discovery, process management,
 * and streaming internally — much faster than manual CLI spawning.
 */

// SDK is ESM-only, so we dynamic-import it
let sdkModule = null;
async function getSDK() {
  if (!sdkModule) {
    sdkModule = await import('@anthropic-ai/claude-agent-sdk');
  }
  return sdkModule;
}

/**
 * Creates a Claude Code plugin instance.
 *
 * @param {object} options
 * @param {string} options.workingDirectory — where Claude Code operates
 * @param {boolean} options.fullAccess — bypass all permission checks (default: true)
 * @param {string[]} options.allowedTools — if fullAccess is false, tools to auto-approve
 * @param {string} options.systemPrompt — optional system prompt to append
 * @param {string} options.model — model to use (default: claude-sonnet-4-6)
 */
function createClaudeCodePlugin(options = {}) {
  const {
    workingDirectory = process.cwd(),
    fullAccess = true,
    allowedTools = [],
    systemPrompt = '',
    model = 'claude-sonnet-4-6'
  } = options;

  // Track session for multi-turn
  let sessionId = null;

  return {
    name: 'claude-code',

    onUserMessage: async (text, { eventBus, pane }) => {
      const sdk = await getSDK();
      const paneId = pane || 'a';

      // Build query options
      const queryOpts = {
        cwd: workingDirectory,
        model,
        ...(fullAccess
          ? { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true }
          : allowedTools.length > 0
            ? { allowedTools }
            : {}
        ),
        ...(systemPrompt
          ? { systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt } }
          : {}
        ),
        ...(sessionId ? { resume: sessionId } : {})
      };

      // Run the query
      const conversation = sdk.query({ prompt: text, options: queryOpts });

      let lastTextContent = '';

      for await (const msg of conversation) {
        // Assistant message — extract text and tool calls
        if (msg.type === 'assistant' && msg.message) {
          const content = msg.message.content || [];
          for (const block of content) {
            if (block.type === 'text') {
              lastTextContent = block.text;
            }
            if (block.type === 'tool_use') {
              eventBus.emit('tool-call', paneId, {
                tool: block.name,
                args: block.input,
                id: block.id
              });
            }
          }
        }

        // Result — capture session ID for next turn
        if (msg.type === 'result') {
          if (msg.session_id) {
            sessionId = msg.session_id;
          }
          if (msg.result) {
            lastTextContent = msg.result;
          }
        }
      }

      return lastTextContent || '(done)';
    }
  };
}

module.exports = { createClaudeCodePlugin };
