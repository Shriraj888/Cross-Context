// Cross Context — Gemini Injector
// Injects context into gemini.google.com's input field

export async function injectContext(formattedPrompt) {
  return new Promise((resolve) => {
    const attempt = (retries = 0) => {
      // Gemini uses a rich text editor (contenteditable)
      const inputEl = document.querySelector(
        'rich-textarea [contenteditable="true"], ' +
        '.ql-editor[contenteditable="true"], ' +
        '[contenteditable="true"][data-placeholder*="message"], ' +
        'div.textarea[contenteditable="true"]'
      );

      if (!inputEl) {
        if (retries < 12) {
          setTimeout(() => attempt(retries + 1), 800);
        } else {
          resolve({ success: false, error: 'Gemini input not found' });
        }
        return;
      }

      inputEl.focus();
      inputEl.click();

      // Clear and insert using selection range to avoid breaking Quill
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

      // Auto-submit
      setTimeout(() => {
        const sendBtn = document.querySelector(
          'button.send-button, ' +
          'button[aria-label*="Send"], ' +
          'button[mattooltip*="Send"], ' +
          '.send-button-container button'
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
