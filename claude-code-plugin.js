/**
 * Claude Code Plugin — powers Pane A with a real Claude Code session.
 *
 * When you type in Pane A, your message gets sent to a `claude` CLI process
 * running in the background. Claude Code does its thing — reads files, edits
 * code, runs commands — and the results stream back into Pane A.
 *
 * The event bus captures everything, so Pane B sees it all.
 *
 * Auto-discovers the `claude` binary — checks PATH first, then known install
 * locations (Claude desktop app, npm global, etc.). Updates automatically
 * when the app updates to a new version.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Find the claude CLI binary. Returns { command, prefixArgs } where:
 *   - command is what to pass to spawn() as the first arg
 *   - prefixArgs are args to prepend (e.g. the script path when running via node)
 *
 * Node.js spawn() can't execute shebang scripts on all platforms, so if the
 * binary is a Node script we run it as `node <script>` instead.
 */
function findClaudeBinary() {
  // Helper: find latest semver directory and return the binary inside it
  function latestVersionBinary(baseDir, binarySubpath) {
    try {
      if (!fs.existsSync(baseDir)) return null;
      const versions = fs.readdirSync(baseDir)
        .filter(d => /^\d+\.\d+\.\d+$/.test(d))
        .sort((a, b) => {
          const pa = a.split('.').map(Number);
          const pb = b.split('.').map(Number);
          for (let i = 0; i < 3; i++) {
            if (pa[i] !== pb[i]) return pb[i] - pa[i];
          }
          return 0;
        });
      for (const ver of versions) {
        const candidate = path.join(baseDir, ver, binarySubpath);
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch (e) { /* can't read directory */ }
    return null;
  }

  // Helper: check if a file is a script (has shebang) vs native binary
  function resolveSpawn(filePath) {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(2);
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      if (buf.toString() === '#!') {
        // It's a script — run through node to avoid ENOEXEC
        return { command: process.execPath, prefixArgs: [filePath] };
      }
    } catch (e) { /* fall through */ }
    return { command: filePath, prefixArgs: [] };
  }

  // Candidate paths in priority order
  const candidates = [];

  // 1. Check PATH
  try {
    const result = execSync('which claude 2>/dev/null || where claude 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 3000
    }).trim();
    if (result) candidates.push(result);
  } catch (e) { /* not on PATH */ }

  // 2. Claude desktop app — native macOS binary
  const claudeCodeBase = path.join(
    process.env.HOME || '',
    'Library/Application Support/Claude/claude-code'
  );
  const macNative = latestVersionBinary(claudeCodeBase, 'claude.app/Contents/MacOS/claude');
  if (macNative) candidates.push(macNative);

  // 3. Windows — Claude desktop app
  const appDataLocal = process.env.LOCALAPPDATA || '';
  if (appDataLocal) {
    const winBase = path.join(appDataLocal, 'Claude', 'claude-code');
    const winBin = latestVersionBinary(winBase, 'claude.exe');
    if (winBin) candidates.push(winBin);
  }

  // 4. Common npm global locations
  const npmPaths = [
    path.join(process.env.HOME || '', '.npm-global/bin/claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude'
  ];
  for (const p of npmPaths) {
    if (fs.existsSync(p)) candidates.push(p);
  }

  // Pick first candidate and resolve how to spawn it
  for (const c of candidates) {
    return resolveSpawn(c);
  }

  // Fallback
  return { command: 'claude', prefixArgs: [] };
}

/**
 * Creates a Claude Code plugin instance.
 *
 * @param {object} options
 * @param {string} options.workingDirectory — where Claude Code operates (default: workspace root)
 * @param {boolean} options.fullAccess — skip all permission prompts (default: true)
 * @param {string[]} options.allowedTools — if fullAccess is false, tools to auto-approve
 * @param {string} options.systemPrompt — optional additional system prompt
 */
function createClaudeCodePlugin(options = {}) {
  const {
    workingDirectory = process.cwd(),
    fullAccess = true,
    allowedTools = [],
    systemPrompt = ''
  } = options;

  // Auto-discover claude binary (re-resolves each session to pick up updates)
  let resolved = null;

  // Track the conversation for multi-turn via session ID
  let sessionId = null;

  return {
    name: 'claude-code',

    onUserMessage: async (text, { eventBus }) => {
      // Resolve binary on first call (and cache it for the session)
      if (!resolved) {
        resolved = findClaudeBinary();
        console.log(`[claude-code-plugin] Resolved: ${resolved.command} ${resolved.prefixArgs.join(' ')}`);
      }

      return new Promise((resolve, reject) => {
        const args = [
          ...resolved.prefixArgs,
          '-p', text,
          '--output-format', 'stream-json',
          '--verbose'
        ];

        // Permission mode
        if (fullAccess) {
          args.push('--dangerously-skip-permissions');
        } else if (allowedTools.length > 0) {
          args.push('--allowedTools', allowedTools.join(','));
        }

        if (systemPrompt) {
          args.push('--append-system-prompt', systemPrompt);
        }

        // Multi-turn: resume previous session if we have one
        if (sessionId) {
          args.push('--resume', sessionId);
        }

        const child = spawn(resolved.command, args, {
          cwd: workingDirectory,
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let lastTextContent = '';
        let buffer = '';

        const captureSessionId = (id) => { sessionId = id; };

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
              }, captureSessionId);
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
              }, captureSessionId);
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
function handleStreamEvent(event, eventBus, onText, onSessionId) {
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
    // Capture session_id for multi-turn --resume
    if (event.session_id && onSessionId) {
      onSessionId(event.session_id);
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
