// Cross Context — Gemini Injector
// Injects context into gemini.google.com's input field

export async function injectContext(formattedPrompt) {
  return new Promise((resolve) => {
    const attempt = (retries = 0) => {
      // Gemini uses a rich text editor (contenteditable)
      const inputEl = document.querySelector(
        'rich-textarea div[contenteditable="true"], ' +
        'div.ql-editor[contenteditable="true"], ' +
        'div[role="textbox"][contenteditable="true"], ' +
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

      let success = document.execCommand('insertText', false, formattedPrompt);

      // Fallback: paste via ClipboardEvent
      if (!success || !inputEl.textContent.trim()) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', formattedPrompt);
          const pasteEvt = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
          });
          inputEl.dispatchEvent(pasteEvt);
        } catch (_) {}
      }

      // Fallback: direct innerHTML with Quill-compatible <p> tags
      if (!inputEl.textContent.trim()) {
        try {
          inputEl.innerHTML = formattedPrompt.split('\n').map(line => {
            const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return escaped.trim() ? `<p>${escaped}</p>` : '<p><br></p>';
          }).join('');
          inputEl.classList.remove('ql-blank');
        } catch (_) {
          inputEl.innerText = formattedPrompt;
        }
      }

      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      // Also dispatch on parent for Angular/Quill frameworks
      try {
        const parent = inputEl.closest('fieldset') || inputEl.closest('rich-textarea') || inputEl.parentElement;
        if (parent) {
          parent.dispatchEvent(new Event('input', { bubbles: true }));
          parent.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (_) {}

      // Auto-submit
      setTimeout(() => {
        const sendBtn = document.querySelector(
          'button[aria-label*="Send message" i], ' +
          'button[aria-label*="Send prompt" i], ' +
          'button[aria-label*="Send" i], ' +
          'button.send-button, ' +
          'button[mattooltip*="Send" i], ' +
          '[data-test-id="send-button"], ' +
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
