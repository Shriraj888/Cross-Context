// Cross Context — Storage Helpers
//
// @author      Shriraj888 <https://github.com/Shriraj888>
// @source      https://github.com/Shriraj888/Cross-Context
// @license     MIT
// @copyright   © 2026 Shriraj888. All rights reserved.

/* WATERMARK: Cross-Context · Shriraj888 · github.com/Shriraj888/Cross-Context */

/**
 * Save a new context to local storage
 */
export async function saveContext(context) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'SAVE_CONTEXT', payload: context }, resolve);
  });
}

/**
 * Get all saved contexts
 */
export async function getContexts() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_CONTEXTS' }, resolve);
  });
}

/**
 * Delete a context by ID
 */
export async function deleteContext(id) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'DELETE_CONTEXT', id }, resolve);
  });
}

/**
 * Clear all contexts
 */
export async function clearContexts() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CLEAR_CONTEXTS' }, resolve);
  });
}

/**
 * Trigger context injection into a target LLM tab
 */
export async function injectContext(context, targetPlatform) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'INJECT_CONTEXT',
      payload: { context, targetPlatform }
    }, resolve);
  });
}
