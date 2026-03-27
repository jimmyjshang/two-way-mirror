/**
 * Plugin Interface — where you wire up your own AI backends.
 *
 * Two-Way Mirror doesn't care what powers Pane A or Pane B.
 * You provide a plugin for each side. A plugin is just an object with:
 *
 *   {
 *     name: string,
 *     onUserMessage: async (text, context) => string | null
 *   }
 *
 * That's it. When the user types in a pane, onUserMessage is called.
 * Return a string to send a response back, or null for no response.
 *
 * The `context` object gives you:
 *   - eventBus: the shared EventBus (Pane B can read all of Pane A's history)
 *   - pane: 'a' or 'b'
 *   - history: array of { role: 'user' | 'agent', text } for this pane
 *
 * --- EXAMPLES ---
 *
 * // Simplest possible plugin — echoes back what you said:
 * const echoPlugin = {
 *   name: 'echo',
 *   onUserMessage: async (text) => `You said: ${text}`
 * };
 *
 * // Claude API plugin (bring your own key):
 * const claudePlugin = {
 *   name: 'claude',
 *   onUserMessage: async (text, { history }) => {
 *     const response = await callClaudeAPI(history);
 *     return response;
 *   }
 * };
 *
 * // Observer plugin for Pane B — reads Pane A's history:
 * const observerPlugin = {
 *   name: 'observer',
 *   onUserMessage: async (text, { eventBus }) => {
 *     const paneAHistory = eventBus.getHistory({ pane: 'a' });
 *     const response = await analyzeWithAI(text, paneAHistory);
 *     return response;
 *   }
 * };
 */

/**
 * Built-in echo plugin — used as the default / demo.
 * Replace this with your own.
 */
const echoPlugin = {
  name: 'echo',
  onUserMessage: async (text, _context) => {
    return `(echo) ${text}`;
  }
};

/**
 * Built-in pass-through observer for Pane B.
 * Shows Pane A activity and echoes your messages.
 * Replace this with your own reviewer/coach/analyzer.
 */
const observerPlugin = {
  name: 'observer',
  onUserMessage: async (text, { eventBus }) => {
    const paneAEvents = eventBus.getHistory({ pane: 'a' });
    const summary = paneAEvents.length === 0
      ? 'Nothing has happened in Pane A yet.'
      : `Pane A has ${paneAEvents.length} events so far.`;
    return `${summary}\n\nYou said: ${text}`;
  }
};

/**
 * Validate that a plugin has the required shape.
 */
function validatePlugin(plugin, label) {
  if (!plugin || typeof plugin !== 'object') {
    throw new Error(`${label} plugin must be an object`);
  }
  if (typeof plugin.onUserMessage !== 'function') {
    throw new Error(`${label} plugin must have an onUserMessage(text, context) function`);
  }
  if (!plugin.name) {
    plugin.name = label;
  }
  return plugin;
}

module.exports = { echoPlugin, observerPlugin, validatePlugin };
