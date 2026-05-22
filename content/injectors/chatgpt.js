// Cross Context — ChatGPT Injector
// Injects context into chatgpt.com's input field

export async function injectContext(formattedPrompt) {
  return new Promise((resolve) => {
    const attempt = (retries = 0) => {
      // ChatGPT uses a contenteditable div (ProseMirror) or a textarea
      const inputEl = document.querySelector(
        '#prompt-textarea, ' +
        'div[contenteditable="true"].ProseMirror, ' +
        'textarea[data-id="root"], ' +
        '[data-testid="send-button"]'
      ) && document.querySelector(
        '#prompt-textarea, ' +
        'div[contenteditable="true"][id*="prompt"], ' +
        'div[contenteditable="true"].ProseMirror'
      );

      // Re-query properly
      const input = document.querySelector('#prompt-textarea')
        || document.querySelector('div[contenteditable="true"].ProseMirror')
        || document.querySelector('textarea[placeholder]')
        || document.querySelector('[data-testid="prompt-textarea"]');

      if (!input) {
        if (retries < 12) {
          setTimeout(() => attempt(retries + 1), 700);
        } else {
          resolve({ success: false, error: 'ChatGPT input not found' });
        }
        return;
      }

      input.focus();
      input.click();

      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        input.select();
        const success = document.execCommand('insertText', false, formattedPrompt);
        if (!success || input.value !== formattedPrompt) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeInputValueSetter.call(input, formattedPrompt);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('selectAll', false, null);
        const success = document.execCommand('insertText', false, formattedPrompt);
        if (!success || !input.textContent.trim()) {
          input.innerText = formattedPrompt;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // Auto-submit
      setTimeout(() => {
        const sendBtn = document.querySelector(
          '[data-testid="send-button"], ' +
          'button[aria-label="Send message"], ' +
          'button[aria-label="Send prompt"]'
        );
        const isDisabled = sendBtn && (sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true' || sendBtn.classList.contains('disabled'));
        if (sendBtn && !isDisabled) {
          sendBtn.click();
          resolve({ success: true });
        } else {
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, shiftKey: false
          }));
          resolve({ success: true });
        }
      }, 1200);
    };

    attempt();
  });
}
