// Cross Context — Grok Injector
// Injects context into grok.com's input field

export async function injectContext(formattedPrompt) {
  return new Promise((resolve) => {
    const attempt = (retries = 0) => {
      // Grok uses a textarea or contenteditable
      const inputEl = document.querySelector(
        'textarea[placeholder*="Ask"], ' +
        'textarea[placeholder*="Grok"], ' +
        '[contenteditable="true"][placeholder], ' +
        'textarea.r-30o5oe, ' +
        'textarea[class*="input"]'
      );

      if (!inputEl) {
        if (retries < 12) {
          setTimeout(() => attempt(retries + 1), 700);
        } else {
          resolve({ success: false, error: 'Grok input not found' });
        }
        return;
      }

      inputEl.focus();
      inputEl.click();

      if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        inputEl.select();
        const success = document.execCommand('insertText', false, formattedPrompt);
        if (!success || inputEl.value !== formattedPrompt) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          ).set;
          nativeInputValueSetter.call(inputEl, formattedPrompt);
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
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
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // Auto-submit
      setTimeout(() => {
        const sendBtn = document.querySelector(
          'button[aria-label*="Send"], ' +
          'button[type="submit"], ' +
          '[data-testid*="send"]'
        );
        const isDisabled = sendBtn && (sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true' || sendBtn.classList.contains('disabled'));
        if (sendBtn && !isDisabled) {
          sendBtn.click();
          resolve({ success: true });
        } else {
          inputEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
          }));
          resolve({ success: true });
        }
      }, 1200);
    };

    attempt();
  });
}
