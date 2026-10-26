/**
 * Node-only entry point (`@markdown2/core/node`).
 *
 * Kept separate so that the main entry point stays free of Node APIs and
 * runs in browsers and workers.
 */
export * from './uri-policy.js';
export * from './cli.js';
