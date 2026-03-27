const vscode = require('vscode');
const { EventBus } = require('./event-bus');
const { echoPlugin, observerPlugin, validatePlugin } = require('./plugin-interface');

// ============================================================
// CONFIGURE YOUR PLUGINS HERE
// ============================================================
// Replace these with your own plugins. See plugin-interface.js
// for the interface and examples.
//
// Pane A: the "primary" session (coding, chatting, whatever).
//         Pane A has NO idea Pane B exists.
//
// Pane B: the "mirror" / observer / reviewer.
//         Pane B can see everything Pane A does via the EventBus.
//
const PANE_A_PLUGIN = echoPlugin;       // <-- swap this
const PANE_B_PLUGIN = observerPlugin;   // <-- swap this
// ============================================================

function activate(context) {
  const disposable = vscode.commands.registerCommand('twoWayMirror.open', () => {
    TwoWayMirrorPanel.createOrShow(context.extensionUri);
  });
  context.subscriptions.push(disposable);
}

class TwoWayMirrorPanel {
  static currentPanel;
  static viewType = 'twoWayMirror';

  static createOrShow(extensionUri) {
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

    TwoWayMirrorPanel.currentPanel = new TwoWayMirrorPanel(panel);
  }

  constructor(panel) {
    this.panel = panel;
    this.eventBus = new EventBus();
    this.pluginA = validatePlugin(PANE_A_PLUGIN, 'Pane A');
    this.pluginB = validatePlugin(PANE_B_PLUGIN, 'Pane B');
    this.historyA = [];
    this.historyB = [];

    this.panel.webview.html = this.getHtml();

    // Auto-forward Pane A activity to Pane B's UI
    this.eventBus.on('*', (event) => {
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

    // Call the plugin
    const context = {
      eventBus: this.eventBus,
      pane,
      history: [...history]
    };

    try {
      const response = await plugin.onUserMessage(text, context);
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
    <div class="pane-header" onclick="setActive('a')">Pane A &mdash; Primary Session</div>
    <div class="messages" id="messages-a">
      <div class="placeholder">Primary session. Plug in any AI backend.<br>This side has no idea Pane B exists.</div>
    </div>
    <div class="input-area">
      <input type="text" id="input-a" placeholder="Type a message..." />
      <button onclick="sendMessage('a')">Send</button>
    </div>
  </div>

  <div class="divider"></div>

  <div class="pane" id="pane-b">
    <div class="pane-header" onclick="setActive('b')">Pane B &mdash; Mirror / Observer</div>
    <div class="messages" id="messages-b">
      <div class="placeholder">Observer session. Sees all of Pane A's activity.<br>Plug in your own reviewer, coach, or analyzer.</div>
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
      addMessage('b', 'system', msg.text, true);
    }
  });
</script>

</body>
</html>`;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
