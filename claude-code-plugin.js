/**
 * Claude Code Plugin — powers Pane A with a real Claude Code session.
 *
 * When you type in Pane A, your message gets sent to a `claude` CLI process
 * running in the background. Claude Code does its thing — reads files, edits
 * code, runs commands — and the results stream back into Pane A.
 *
 * The event bus captures everything, so Pane B sees it all.
 *
 * Requirements:
 *   - `claude` CLI installed and on your PATH
 *   - Authenticated (run `claude` once in terminal to set up)
 */

const { spawn } = require('child_process');
const path = require('path');

/**
 * Creates a Claude Code plugin instance.
 *
 * @param {object} options
 * @param {string} options.workingDirectory — where Claude Code operates (default: workspace root)
 * @param {string[]} options.allowedTools — tools to auto-approve (default: all standard tools)
 * @param {string} options.systemPrompt — optional additional system prompt
 */
function createClaudeCodePlugin(options = {}) {
  const {
    workingDirectory = process.cwd(),
    allowedTools = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    systemPrompt = ''
  } = options;

  // Track the conversation for multi-turn
  let conversationId = null;

  return {
    name: 'claude-code',

    onUserMessage: async (text, { eventBus }) => {
      return new Promise((resolve, reject) => {
        const args = [
          '-p', text,
          '--output-format', 'stream-json',
          '--verbose'
        ];

        if (allowedTools.length > 0) {
          args.push('--allowedTools', allowedTools.join(','));
        }

        if (systemPrompt) {
          args.push('--append-system-prompt', systemPrompt);
        }

        if (conversationId) {
          args.push('--continue', conversationId);
        }

        const child = spawn('claude', args, {
          cwd: workingDirectory,
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let fullResponse = '';
        let lastTextContent = '';
        let buffer = '';

        child.stdout.on('data', (chunk) => {
          buffer += chunk.toString();

          // Parse newline-delimited JSON
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              handleStreamEvent(event, eventBus, (text) => {
                lastTextContent = text;
              });
            } catch (e) {
              // Not JSON, might be plain text output
              if (line.trim()) {
                lastTextContent += line;
              }
            }
          }
        });

        child.stderr.on('data', (chunk) => {
          const text = chunk.toString().trim();
          if (text) {
            eventBus.emit('error', 'a', { message: text });
          }
        });

        child.on('close', (code) => {
          // Flush remaining buffer
          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer);
              handleStreamEvent(event, eventBus, (text) => {
                lastTextContent = text;
              });
            } catch (e) {
              if (buffer.trim()) {
                lastTextContent += buffer.trim();
              }
            }
          }

          if (code !== 0 && !lastTextContent) {
            reject(new Error(`Claude Code exited with code ${code}`));
          } else {
            resolve(lastTextContent || '(done)');
          }
        });

        child.on('error', (err) => {
          reject(new Error(`Failed to start Claude Code: ${err.message}. Is 'claude' on your PATH?`));
        });
      });
    }
  };
}

/**
 * Parse a stream-json event from Claude Code and emit to the event bus.
 */
function handleStreamEvent(event, eventBus, onText) {
  // Claude Code stream-json events have different shapes.
  // Common types: assistant message, tool_use, tool_result, result

  if (event.type === 'assistant' && event.message) {
    // Assistant message — may contain text and/or tool_use blocks
    const content = event.message.content || [];
    for (const block of content) {
      if (block.type === 'text') {
        onText(block.text);
      }
      if (block.type === 'tool_use') {
        eventBus.emit('tool-call', 'a', {
          tool: block.name,
          args: block.input,
          id: block.id
        });
      }
    }
  }

  if (event.type === 'content_block_delta') {
    if (event.delta?.type === 'text_delta') {
      onText(event.delta.text);
    }
  }

  if (event.type === 'result') {
    // Final result
    if (event.session_id) {
      // Could store for --continue in future turns
    }
    if (event.result) {
      onText(event.result);
    }
  }

  // Tool results from Claude Code
  if (event.type === 'tool_result' || event.tool_result) {
    const result = event.tool_result || event;
    eventBus.emit('tool-result', 'a', {
      id: result.tool_use_id,
      summary: typeof result.content === 'string'
        ? result.content.slice(0, 200)
        : '(result)'
    });
  }
}

module.exports = { createClaudeCodePlugin };
