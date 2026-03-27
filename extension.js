const vscode = require('vscode');
const { EventBus } = require('./event-bus');
const { echoPlugin, observerPlugin, validatePlugin } = require('./plugin-interface');
const { createClaudeCodePlugin } = require('./plugins/claude');

// ============================================================
// PLUGIN REGISTRY
// ============================================================
// Add new plugins here. They'll automatically appear in the
// configuration quick pick.

const PANE_B_SYSTEM_PROMPT = `You are an observer in Pane B of a two-way mirror. Pane A is running a separate Claude Code session that cannot see you. You receive a live feed of everything Pane A does — user messages, agent responses, tool calls, and results. Use this context to help the user: review Pane A's work, catch mistakes, suggest improvements, or provide a second opinion. You have full tool access yourself. When the user talks to you, they're asking for your independent perspective on what's happening in Pane A.`;

function resolvePlugin(id, pane) {
  const workingDirectory = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();

  switch (id) {
    case 'claude':
      return pane === 'b'
        ? createClaudeCodePlugin({ workingDirectory, systemPrompt: PANE_B_SYSTEM_PROMPT })
        : createClaudeCodePlugin({ workingDirectory });
    case 'observer':
      return observerPlugin;
    case 'echo':
      return echoPlugin;
    default:
      return echoPlugin;
  }
}

// Labels for the quick pick UI
const PLUGIN_LABELS = {
  claude: 'Claude Code',
  echo: 'Echo (no AI)',
  observer: 'Observer (read-only log)'
};

// ============================================================
// CONFIGURATION UI
// ============================================================

async function promptPluginConfig() {
  const config = vscode.workspace.getConfiguration('twoWayMirror');

  // Step 1: Where should Claude Code run?
  const choice = await vscode.window.showQuickPick([
    { label: 'Pane A only', description: 'Claude in A, observer in B', detail: 'The standard setup — work in A, watch in B', value: 'a-only' },
    { label: 'Pane B only', description: 'Echo in A, Claude reviewer in B', detail: 'Use B as a standalone reviewer session', value: 'b-only' },
    { label: 'Both panes', description: 'Claude in A + Claude reviewer in B', detail: 'Two independent Claude sessions — A works, B reviews', value: 'both' },
    { label: 'Neither', description: 'Echo shell in both panes', detail: 'No AI — just the raw two-pane shell', value: 'neither' },
  ], {
    placeHolder: 'Where should Claude Code run?',
    title: 'Two-Way Mirror — Plugin Setup'
  });

  if (!choice) return null; // user cancelled

  let paneA, paneB;
  switch (choice.value) {
    case 'a-only':  paneA = 'claude'; paneB = 'observer'; break;
    case 'b-only':  paneA = 'echo';   paneB = 'claude';   break;
    case 'both':    paneA = 'claude'; paneB = 'claude';   break;
    case 'neither': paneA = 'echo';   paneB = 'echo';     break;
  }

  await config.update('paneA', paneA, vscode.ConfigurationTarget.Global);
  await config.update('paneB', paneB, vscode.ConfigurationTarget.Global);

  return { paneA, paneB };
}

function getPluginConfig() {
  const config = vscode.workspace.getConfiguration('twoWayMirror');
  return {
    paneA: config.get('paneA') || '',
    paneB: config.get('paneB') || ''
  };
}

// ============================================================
// EXTENSION ACTIVATION
// ============================================================

function activate(context) {
  // Main open command
  const openCmd = vscode.commands.registerCommand('twoWayMirror.open', async () => {
    let { paneA, paneB } = getPluginConfig();

    // First time? Show the setup prompt
    if (!paneA || !paneB) {
      const result = await promptPluginConfig();
      if (!result) return; // user cancelled
      paneA = result.paneA;
      paneB = result.paneB;
    }

    TwoWayMirrorPanel.createOrShow(context.extensionUri, paneA, paneB);
  });

  // Configure plugins command (can re-run anytime)
  const configCmd = vscode.commands.registerCommand('twoWayMirror.configurePlugins', async () => {
    const result = await promptPluginConfig();
    if (!result) return;

    // If panel is already open, notify user to reopen
    if (TwoWayMirrorPanel.currentPanel) {
      const action = await vscode.window.showInformationMessage(
        'Plugin configuration updated. Reopen Two-Way Mirror to apply changes.',
        'Reopen now'
      );
      if (action === 'Reopen now') {
        TwoWayMirrorPanel.currentPanel.panel.dispose();
        TwoWayMirrorPanel.createOrShow(context.extensionUri, result.paneA, result.paneB);
      }
    }
  });

  context.subscriptions.push(openCmd, configCmd);
}

class TwoWayMirrorPanel {
  static currentPanel;
  static viewType = 'twoWayMirror';

  static createOrShow(extensionUri, paneAId, paneBId) {
    if (TwoWayMirrorPanel.currentPanel) {
      TwoWayMirrorPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      TwoWayMirrorPanel.viewType,
      'Two-Way Mirror',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    TwoWayMirrorPanel.currentPanel = new TwoWayMirrorPanel(panel, paneAId, paneBId);
  }

  constructor(panel, paneAId, paneBId) {
    this.panel = panel;
    this.eventBus = new EventBus();
    this.paneAId = paneAId;
    this.paneBId = paneBId;
    this.pluginA = validatePlugin(resolvePlugin(paneAId, 'a'), 'Pane A');
    this.pluginB = validatePlugin(resolvePlugin(paneBId, 'b'), 'Pane B');
    this.historyA = [];
    this.historyB = [];

    this.panel.webview.html = this.getHtml();

    // Forward activity to the UI
    this.eventBus.on('*', (event) => {
      // Show tool calls in whichever pane they came from
      if (event.type === 'tool-call' || event.type === 'tool-result') {
        this.panel.webview.postMessage({
          type: 'activityLog',
          pane: event.pane,
          text: this.formatEvent(event)
        });
      }

      // Also forward all Pane A activity to Pane B's UI as a log
      if (event.pane === 'a') {
        this.panel.webview.postMessage({
          type: 'activityLog',
          pane: 'b',
          text: this.formatEvent(event)
        });
      }
    });

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));

    this.panel.onDidDispose(() => {
      TwoWayMirrorPanel.currentPanel = undefined;
    });
  }

  async handleMessage(msg) {
    if (msg.type !== 'userMessage') return;

    const { pane, text } = msg;
    const history = pane === 'a' ? this.historyA : this.historyB;
    const plugin = pane === 'a' ? this.pluginA : this.pluginB;

    // Log user message
    history.push({ role: 'user', text });
    this.eventBus.emit('user-message', pane, { text });

    // For Pane B: prepend recent Pane A activity so Claude B has context
    let promptText = text;
    if (pane === 'b' && this.pluginB.name === 'claude-code') {
      const paneAActivity = this.getPaneASummary();
      if (paneAActivity) {
        promptText = `[PANE A ACTIVITY LOG]\n${paneAActivity}\n[END PANE A ACTIVITY]\n\nUser message: ${text}`;
      }
    }

    // Call the plugin
    const context = {
      eventBus: this.eventBus,
      pane,
      history: [...history]
    };

    try {
      const response = await plugin.onUserMessage(promptText, context);
      if (response) {
        history.push({ role: 'agent', text: response });
        this.eventBus.emit('agent-response', pane, { text: response });
        this.panel.webview.postMessage({
          type: 'agentMessage',
          pane,
          text: response
        });
      }
    } catch (err) {
      this.eventBus.emit('error', pane, { message: err.message });
      this.panel.webview.postMessage({
        type: 'agentMessage',
        pane,
        text: `Error: ${err.message}`
      });
    }
  }

  getPaneASummary() {
    const events = this.eventBus.getHistory({ pane: 'a' });
    if (events.length === 0) return '';

    // Take last 50 events to keep it manageable
    const recent = events.slice(-50);
    return recent.map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString();
      switch (e.type) {
        case 'user-message':
          return `[${time}] User → Pane A: ${e.data.text}`;
        case 'agent-response':
          return `[${time}] Pane A agent: ${e.data.text}`;
        case 'tool-call':
          return `[${time}] Tool call: ${e.data.tool} ${JSON.stringify(e.data.args || {})}`;
        case 'tool-result':
          return `[${time}] Tool result: ${e.data.summary || '(done)'}`;
        case 'error':
          return `[${time}] Error: ${e.data.message}`;
        default:
          return `[${time}] ${e.type}: ${JSON.stringify(e.data)}`;
      }
    }).join('\n');
  }

  formatEvent(event) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    switch (event.type) {
      case 'user-message':
        return `[${time}] User said: ${event.data.text}`;
      case 'agent-response':
        return `[${time}] Agent replied: ${event.data.text}`;
      case 'tool-call':
        return `[${time}] Tool call: ${event.data.tool} ${JSON.stringify(event.data.args || {})}`;
      case 'tool-result':
        return `[${time}] Tool result: ${event.data.summary || '(done)'}`;
      default:
        return `[${time}] ${event.type}: ${JSON.stringify(event.data)}`;
    }
  }

  getHtml() {
    const paneALabel = PLUGIN_LABELS[this.paneAId] || this.paneAId;
    const paneBLabel = PLUGIN_LABELS[this.paneBId] || this.paneBId;

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    height: 100vh;
    display: flex;
    flex-direction: column;
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }

  .header {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 8px;
    gap: 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .header h1 { font-size: 14px; font-weight: 600; }
  .header span { font-size: 12px; opacity: 0.6; }

  .panes { display: flex; flex: 1; overflow: hidden; }

  .pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--vscode-panel-border);
  }

  .pane:last-child { border-right: none; }

  .pane.active .pane-header {
    color: var(--vscode-textLink-foreground);
    border-bottom-color: var(--vscode-textLink-foreground);
  }

  .pane-header {
    padding: 8px 12px;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 2px solid transparent;
    text-align: center;
    cursor: pointer;
    user-select: none;
  }

  .pane-header:hover { background: var(--vscode-list-hoverBackground); }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .message { display: flex; flex-direction: column; gap: 2px; }

  .message .role {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .message .role.you { color: var(--vscode-charts-green, #4ec9b0); }
  .message .role.agent { color: var(--vscode-charts-yellow, #dcdcaa); }
  .message .role.system { color: var(--vscode-charts-orange, #ce9178); opacity: 0.7; }

  .message .text {
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--vscode-input-background);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .message.activity .text {
    background: none;
    opacity: 0.5;
    font-size: 12px;
    padding: 2px 10px;
    font-style: italic;
  }

  .input-area {
    display: flex;
    padding: 8px;
    gap: 6px;
    border-top: 1px solid var(--vscode-panel-border);
  }

  .input-area input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-family: inherit;
    font-size: inherit;
    outline: none;
  }

  .input-area input:focus { border-color: var(--vscode-focusBorder); }

  .input-area button {
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
  }

  .input-area button:hover { background: var(--vscode-button-hoverBackground); }

  .placeholder {
    opacity: 0.5;
    font-style: italic;
    padding: 20px;
    text-align: center;
  }

  .divider {
    width: 1px;
    background: var(--vscode-panel-border);
    position: relative;
  }

  .divider::after {
    content: 'A cannot see B';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-90deg);
    font-size: 10px;
    opacity: 0.3;
    white-space: nowrap;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
</style>
</head>
<body>

<div class="header">
  <h1>Two-Way Mirror</h1>
  <span>Tab to switch panes &middot; A is unaware of B &middot; B sees everything</span>
</div>

<div class="panes">
  <div class="pane active" id="pane-a">
    <div class="pane-header" onclick="setActive('a')">Pane A &mdash; ${paneALabel}</div>
    <div class="messages" id="messages-a">
      <div class="placeholder">${this.paneAId === 'claude' ? 'Claude Code session. Type here — Claude does the work.' : 'Echo shell. Messages are echoed back.'}<br>This side has no idea Pane B exists.</div>
    </div>
    <div class="input-area">
      <input type="text" id="input-a" placeholder="Type a message..." />
      <button onclick="sendMessage('a')">Send</button>
    </div>
  </div>

  <div class="divider"></div>

  <div class="pane" id="pane-b">
    <div class="pane-header" onclick="setActive('b')">Pane B &mdash; ${paneBLabel}</div>
    <div class="messages" id="messages-b">
      <div class="placeholder">${this.paneBId === 'claude' ? 'Claude Code reviewer. Gets a live feed of Pane A.' : this.paneBId === 'observer' ? 'Observer. Sees all of Pane A\'s activity.' : 'Echo shell.'}<br>Pane A cannot see this side.</div>
    </div>
    <div class="input-area">
      <input type="text" id="input-b" placeholder="Type a message..." />
      <button onclick="sendMessage('b')">Send</button>
    </div>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let activePane = 'a';

  function setActive(pane) {
    activePane = pane;
    document.getElementById('pane-a').classList.toggle('active', pane === 'a');
    document.getElementById('pane-b').classList.toggle('active', pane === 'b');
    document.getElementById('input-' + pane).focus();
  }

  function addMessage(pane, role, text, isActivity) {
    const container = document.getElementById('messages-' + pane);
    const ph = container.querySelector('.placeholder');
    if (ph) ph.remove();

    const msg = document.createElement('div');
    msg.className = 'message' + (isActivity ? ' activity' : '');
    msg.innerHTML =
      '<div class="role ' + role + '">' + role + '</div>' +
      '<div class="text">' + escapeHtml(text) + '</div>';
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function sendMessage(pane) {
    const input = document.getElementById('input-' + pane);
    const text = input.value.trim();
    if (!text) return;
    addMessage(pane, 'you', text);
    input.value = '';
    vscode.postMessage({ type: 'userMessage', pane, text });
  }

  document.getElementById('input-a').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage('a');
  });
  document.getElementById('input-b').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage('b');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setActive(activePane === 'a' ? 'b' : 'a');
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'agentMessage') {
      addMessage(msg.pane, 'agent', msg.text);
    }
    if (msg.type === 'activityLog') {
      addMessage(msg.pane, 'system', msg.text, true);
    }
  });
</script>

</body>
</html>`;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
