# Two-Way Mirror

A VS Code extension that gives you two side-by-side chat panes — one for working with an AI agent, one for observing and commenting on what that agent is doing. Pane A has no idea Pane B exists. Pane B sees everything.

Think of it like a two-way mirror in an interrogation room. You're on the working side in Pane A. You're on the observation side in Pane B.

## What this is

This is a **shell**, not a finished product. It provides:

- Split-pane UI inside VS Code
- An event bus that pipes all Pane A activity to Pane B in real-time
- A dead-simple plugin interface for wiring up any AI backend to either side

What powers Pane A and Pane B is up to you. You bring your own AI, your own logic, your own use case.

## Use cases

- **Code review in real-time** — code with Claude in A, have a reviewer AI watching in B
- **Agent debugging** — test an agent in A, observe its decisions and tool calls in B
- **Coaching** — work in A, get a second opinion from B without breaking your flow
- **Whatever you want** — it's your mirror

## Installation

### Permanent install (recommended)

```bash
git clone https://github.com/jimmyjshang/two-way-mirror.git
cd two-way-mirror
npm install -g @vscode/vsce
vsce package
code --install-extension two-way-mirror-0.0.1.vsix
```

Once installed, it's always available in any VS Code window. Open it with `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Windows/Linux), or via Command Palette → **"Two-Way Mirror: Open"**.

### Dev mode (temporary, for hacking on it)

```bash
code --extensionDevelopmentPath="/path/to/two-way-mirror"
```

This loads the extension for that VS Code session only. Useful if you're modifying the extension itself.

## Using the Claude Code plugin

Two-Way Mirror ships with a ready-to-go Claude Code plugin that turns Pane A into a full Claude Code session — file editing, bash commands, MCP servers, multi-turn conversations, the works.

It's already wired up by default. Just make sure you have the Claude CLI installed:

```bash
npm install -g @anthropic-ai/claude-code
```

The plugin auto-discovers the `claude` binary (checks PATH, Claude desktop app, common install locations) so there's nothing else to configure.

If you'd rather use the basic echo shell instead, open `extension.js` and swap the plugin:

```js
// Change this:
const PANE_A_PLUGIN = createClaudeCodePlugin({ ... });

// To this:
const PANE_A_PLUGIN = echoPlugin;
```

Then repackage and reinstall (`vsce package && code --install-extension two-way-mirror-0.0.1.vsix --force`).

## Writing your own plugin

A plugin is an object with one function. That's it.

```js
const myPlugin = {
  name: 'my-thing',
  onUserMessage: async (text, { eventBus, history, pane }) => {
    // text     — what the user just typed
    // history  — array of { role: 'user' | 'agent', text } for this pane
    // eventBus — the shared event bus (Pane B can read all of Pane A's history)
    // pane     — 'a' or 'b'

    return 'your response here'; // or null for no response
  }
};
```

### Plugging it in

Open `extension.js` and find these two lines near the top:

```js
const PANE_A_PLUGIN = echoPlugin;       // <-- swap this
const PANE_B_PLUGIN = observerPlugin;   // <-- swap this
```

Replace them with your own plugins. Done.

### Example: Claude API plugin

See `examples/claude-plugin.js` for a ready-to-customize starter that wires up the Claude API to either pane. You'll need:

```bash
npm install @anthropic-ai/sdk
```

And an API key (set `ANTHROPIC_API_KEY` in your environment).

## How the event bus works

Everything that happens in Pane A — user messages, agent responses, tool calls — gets emitted on the event bus. Pane B's plugin can subscribe to this and read the full history:

```js
// Inside a Pane B plugin:
const paneAHistory = eventBus.getHistory({ pane: 'a' });
// Returns every event from Pane A, timestamped and typed
```

Pane A never sees Pane B's events. The mirror is one-way.

### Event types

| Type | Data | When |
|------|------|------|
| `user-message` | `{ text }` | User typed something |
| `agent-response` | `{ text }` | Plugin returned a response |
| `tool-call` | `{ tool, args }` | Agent invoked a tool (if your plugin emits these) |
| `tool-result` | `{ summary }` | Tool returned a result |
| `error` | `{ message }` | Something went wrong |
| `custom` | anything | Whatever you want to emit |

## File structure

```
Two-Way Mirror/
├── package.json           VS Code extension manifest
├── extension.js           Main extension — UI, routing, plugin config
├── event-bus.js           One-way event pipe from A to B
├── plugin-interface.js    Plugin contract + built-in echo/observer defaults
├── plugins/
│   └── claude.js          Claude Code CLI plugin (Pane A default)
├── examples/
│   └── claude-plugin.js   Starter template for Claude API integration
└── README.md              You're reading it
```

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Switch focus between Pane A and Pane B |
| `Enter` | Send message in the active pane |
| `Cmd+Shift+M` | Open Two-Way Mirror |
