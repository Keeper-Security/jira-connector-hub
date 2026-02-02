/**
 * Mock for @forge/resolver module
 * Used in Jest tests to simulate Forge Resolver behavior
 */

class Resolver {
  constructor() {
    this.handlers = new Map();
  }

  define(name, handler) {
    this.handlers.set(name, handler);
    return this;
  }

  getHandler(name) {
    return this.handlers.get(name);
  }

  getHandlers() {
    return this.handlers;
  }
}

module.exports = Resolver;
