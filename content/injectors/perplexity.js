// Cross Context — Perplexity Injector
// Injects context into perplexity.ai's input field

export async function injectContext(formattedPrompt) {
  return new Promise((resolve) => {
    const attempt = (retries = 0) => {
      // Perplexity uses a textarea
      const inputEl = document.querySelector(
        'textarea[placeholder*="Ask"], ' +
        'textarea[placeholder*="Search"], ' +
        'textarea[class*="textarea"], ' +
        '[contenteditable="true"][class*="editor"]'
      );

      if (!inputEl) {
        if (retries < 12) {
          setTimeout(() => attempt(retries + 1), 700);
        } else {
          resolve({ success: false, error: 'Perplexity input not found' });
        }
        return;
      }

      inputEl.focus();
      inputEl.click();

      if (inputEl.tagName === 'TEXTAREA') {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(inputEl, formattedPrompt);
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
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
        }
      }

      // Auto-submit
      setTimeout(() => {
        const sendBtn = document.querySelector(
          'button[aria-label*="Submit"], ' +
          'button[type="submit"], ' +
          'button[class*="send"], ' +
          '[data-testid*="submit"]'
        );
        const isDisabled = sendBtn && (sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true' || sendBtn.classList.contains('disabled'));
        if (sendBtn && !isDisabled) {
          sendBtn.click();
          resolve({ success: true });
        } else {
          inputEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', bubbles: true
          }));
          resolve({ success: true });
        }
      }, 1200);
    };

    attempt();
  });
}
