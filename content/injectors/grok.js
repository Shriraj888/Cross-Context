// Cross Context — Grok Injector
// Injects context into grok.com & x.com/i/grok input fields

export async function injectContext(formattedPrompt) {
  return new Promise((resolve) => {
    const attempt = (retries = 0) => {
      const selectors = [
        'textarea[data-testid*="grok"]',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="Grok"]',
        'textarea[placeholder*="anything"]',
        'textarea[placeholder*="know"]',
        'textarea[placeholder*="prompt"]',
        'textarea[placeholder*="message"]',
        'div[contenteditable="true"][data-testid*="grok"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'textarea.r-30o5oe',
        'textarea[class*="input"]',
        'form textarea',
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

      inputEl.focus();
      try { inputEl.click(); } catch (_) {}

      if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        const tracker = inputEl._valueTracker;
        if (tracker) { try { tracker.setValue(''); } catch (_) {} }

        const setter = Object.getOwnPropertyDescriptor(
          inputEl.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value'
        )?.set;

        if (setter) {
          setter.call(inputEl, formattedPrompt);
        } else {
          inputEl.value = formattedPrompt;
        }

        try {
          inputEl.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: formattedPrompt, bubbles: true, cancelable: true }));
          inputEl.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: formattedPrompt, bubbles: true }));
        } catch (_) {}

        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));

        if (inputEl.value !== formattedPrompt) {
          inputEl.select();
          document.execCommand('insertText', false, formattedPrompt);
        }
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(inputEl);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('selectAll', false, null);
        const success = document.execCommand('insertText', false, formattedPrompt);
        if (!success || !inputEl.textContent.trim()) {
          inputEl.innerText = formattedPrompt;
        }
        try {
          inputEl.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: formattedPrompt, bubbles: true }));
        } catch (_) {}
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Submit
      setTimeout(() => {
        const submitSelectors = [
          'button[aria-label*="Send"]',
          'button[aria-label*="Submit"]',
          'button[aria-label*="Grok"]',
          'button[aria-label*="Ask"]',
          'button[data-testid*="grok"]',
          'button[data-testid*="send"]',
          'button[data-testid*="submit"]',
          'button[type="submit"]',
          'form button[type="submit"]',
          'button[class*="send"]',
          'button[class*="submit"]',
          'div[role="button"][aria-label*="Send"]',
          'form button'
        ].join(', ');

        const sendBtn = document.querySelector(submitSelectors);
        const isDisabled = sendBtn && (sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true' || sendBtn.classList.contains('disabled'));

        if (sendBtn && !isDisabled) {
          try {
            sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          } catch (_) {}
          sendBtn.click();
          resolve({ success: true });
        } else {
          inputEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
          }));
          resolve({ success: true });
        }
      }, 40);
    };

    attempt();
  });
}
