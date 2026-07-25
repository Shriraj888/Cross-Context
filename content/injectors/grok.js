// Cross Context — Grok Injector
// Injects context into grok.com input fields

export async function injectContext(formattedPrompt) {
  return new Promise((resolve) => {
    const attempt = (retries = 0) => {
      // Grok's actual DOM: <textarea placeholder="Ask Grok" aria-label="Ask Grok anything">
      const selectors = [
        'textarea[placeholder*="Ask Grok"]',
        'textarea[aria-label*="Grok"]',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="anything"]',
        'textarea[placeholder*="message"]',
        'textarea'
      ].join(', ');

      const inputEl = document.querySelector(selectors);

      if (!inputEl) {
        if (retries < 40) {
          setTimeout(() => attempt(retries + 1), 50);
        } else {
          resolve({ success: false, error: 'Grok input not found' });
        }
        return;
      }

      // Focus and click first
      inputEl.focus();
      try { inputEl.click(); } catch (_) {}

      // React-compatible value setting:
      // 1. Clear React's value tracker so it detects the change
      const tracker = inputEl._valueTracker;
      if (tracker) { try { tracker.setValue(''); } catch (_) {} }

      // 2. Use the native HTMLTextAreaElement setter
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      )?.set;

      if (setter) {
        setter.call(inputEl, formattedPrompt);
      } else {
        inputEl.value = formattedPrompt;
      }

      // 3. Dispatch events React listens for
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      // 4. Also fire React-specific InputEvent
      try {
        inputEl.dispatchEvent(new InputEvent('input', {
          inputType: 'insertText',
          data: formattedPrompt,
          bubbles: true
        }));
      } catch (_) {}

      // 5. Wait for React to render the Submit button, then click it
      // Grok uses aria-label="Submit" (not "Send")
      const submitSelectors = [
        'button[aria-label="Submit"]',
        'button[aria-label*="Submit"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="Ask"]',
        'button[data-testid*="send"]',
        'button[data-testid*="submit"]',
        'button[type="submit"]'
      ].join(', ');

      let submitAttempts = 0;
      const trySubmit = () => {
        const sendBtn = document.querySelector(submitSelectors);
        const isDisabled = sendBtn && (sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true');

        if (sendBtn && !isDisabled) {
          try {
            sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          } catch (_) {}
          sendBtn.click();
          resolve({ success: true });
        } else if (submitAttempts < 40) {
          submitAttempts++;
          setTimeout(trySubmit, 80);
        } else {
          // Fallback: Enter key
          inputEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
          }));
          resolve({ success: true });
        }
      };

      // Give React 100ms to render the Submit button after text change
      setTimeout(trySubmit, 100);
    };

    attempt();
  });
}
