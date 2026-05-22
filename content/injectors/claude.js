// Cross Context — Claude Injector
// Injects context into claude.ai's input field

export async function injectContext(formattedPrompt) {
  return new Promise((resolve) => {
    const attempt = (retries = 0) => {
      // Claude uses a contenteditable div as its main input
      const inputEl = document.querySelector(
        '[contenteditable="true"][data-placeholder], ' +
        'div.ProseMirror[contenteditable="true"], ' +
        '[data-testid="compose-input"] [contenteditable]'
      );

      if (!inputEl) {
        if (retries < 10) {
          setTimeout(() => attempt(retries + 1), 800);
        } else {
          resolve({ success: false, error: 'Claude input not found' });
        }
        return;
      }

      // Focus the input
      inputEl.focus();
      inputEl.click();

      // Clear and insert using selection range to avoid breaking ProseMirror
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

      // Auto-submit after a short delay
      setTimeout(() => {
        const submitBtn = document.querySelector(
          'button[aria-label*="Send"], button[data-testid*="send"], button[aria-label="Send Message"]'
        );
        const isDisabled = submitBtn && (submitBtn.disabled || submitBtn.getAttribute('aria-disabled') === 'true' || submitBtn.classList.contains('disabled'));
        if (submitBtn && !isDisabled) {
          submitBtn.click();
          resolve({ success: true });
        } else {
          // Try Enter key
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
