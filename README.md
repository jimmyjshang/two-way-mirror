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

1. Clone or copy this folder somewhere local
2. Open VS Code
3. Open the Command Palette (`Cmd+Shift+P`)
4. If you haven't already, run **"Shell Command: Install 'code' command in PATH"**
5. In your terminal:

```bash
code --extensionDevelopmentPath="/path/to/Two-Way Mirror"
```

6. A new VS Code window opens with the extension loaded
7. `Cmd+Shift+P` → **"Two-Way Mirror: Open"** (or `Cmd+Shift+M`)

## Writing a plugin

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
