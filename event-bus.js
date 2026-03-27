/**
 * EventBus — the core of Two-Way Mirror.
 *
 * Everything that happens in Pane A gets broadcast here.
 * Pane B's plugin subscribes to this bus and sees it all.
 * Pane A never knows Pane B exists.
 *
 * Event types:
 *   'user-message'   — user typed something in a pane
 *   'agent-response'  — the AI backend responded
 *   'tool-call'       — the AI invoked a tool (file read, edit, bash, etc.)
 *   'tool-result'     — result of a tool call
 *   'error'           — something went wrong
 *   'custom'          — anything else a plugin wants to emit
 *
 * Each event has the shape:
 *   { type: string, pane: 'a' | 'b', data: any, timestamp: number }
 */

class EventBus {
  constructor() {
    this._listeners = new Map(); // type -> Set<callback>
    this._log = [];              // full event history
  }

  /**
   * Subscribe to events.
   * @param {string} type — event type, or '*' for all events
   * @param {function} callback — receives the event object
   * @returns {function} unsubscribe function
   */
  on(type, callback) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type).add(callback);
    return () => this._listeners.get(type)?.delete(callback);
  }

  /**
   * Emit an event. Automatically timestamps and logs it.
   * @param {string} type
   * @param {'a' | 'b'} pane — which pane originated this
   * @param {any} data
   */
  emit(type, pane, data) {
    const event = { type, pane, data, timestamp: Date.now() };
    this._log.push(event);

    // Notify specific listeners
    this._listeners.get(type)?.forEach(cb => cb(event));
    // Notify wildcard listeners
    this._listeners.get('*')?.forEach(cb => cb(event));
  }

  /**
   * Get full event history (useful for Pane B to "catch up").
   * @param {object} filter — optional { pane, type } to filter by
   * @returns {Array} matching events
   */
  getHistory(filter = {}) {
    return this._log.filter(e => {
      if (filter.pane && e.pane !== filter.pane) return false;
      if (filter.type && e.type !== filter.type) return false;
      return true;
    });
  }

  /** Clear history */
  clear() {
    this._log = [];
  }
}

module.exports = { EventBus };
