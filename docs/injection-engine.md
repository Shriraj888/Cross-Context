# Injection Engine & State Restoration

The **Injection Engine** automates the restoration of conversational state into the target LLM interface. It operates within the target page context inside [`content/content.js`](file:///content/content.js).

---

## 🎯 Dual-Mode Injection Strategy

Cross Context employs a two-tier strategy for delivering context to target platforms:

```
                      ┌────────────────────────────────┐
                      │    Target Platform Detected    │
                      └───────────────┬────────────────┘
                                      │
                                      ▼
                      ┌────────────────────────────────┐
                      │ Does target support file drops │
                      │   or attachment file chips?    │
                      └───────┬────────────────┬───────┘
                              │                │
                        YES   │                │   NO / FAILED
                              ▼                ▼
            ┌──────────────────────────┐  ┌──────────────────────────┐
            │   Mode 1: File Drop      │  │   Mode 2: Fallback Text  │
            │  (context-con_01.md)     │  │    Direct SPA Insertion  │
            └─────────────┬────────────┘  └────────────┬─────────────┘
                          │                            │
                          ▼                            ▼
            ┌──────────────────────────┐  ┌──────────────────────────┐
            │ Poll upload readiness    │  │ Native setter override & │
            │ chip & type companion    │  │ React event dispatching  │
            └─────────────┬────────────┘  └────────────┬─────────────┘
                          │                            │
                          └───────────┬────────────────┘
                                      │
                                      ▼
                      ┌────────────────────────────────┐
                      │ Submit Prompt / Resume Flow    │
                      └────────────────────────────────┘
```

---

## 📄 Mode 1: File Attachment Injection (`context.md`)

Modern LLM models handle large context best when supplied as an attached file rather than pasted into the chat box as thousands of lines of text.

### How It Works:
1. **In-Memory File Creation:**
   A standard JavaScript `File` object is generated in memory containing the full Markdown snapshot:
   ```javascript
   const fileName = `context-${context.id || 'con_01'}.md`;
   const file = new File([markdownContent], fileName, { type: 'text/markdown' });
   ```

2. **DataTransfer & Event Simulation:**
   The injector builds an HTML5 `DataTransfer` container and dispatches synthetic drag-and-drop events directly to the target platform's drop zone or file input:
   ```javascript
   const dt = new DataTransfer();
   dt.items.add(file);

   // Target dropzone or file input element
   const dropEvent = new DragEvent('drop', {
     bubbles: true,
     cancelable: true,
     dataTransfer: dt
   });
   dropTarget.dispatchEvent(dropEvent);
   ```

3. **Upload Readiness Polling (`waitForFileUploadComplete`):**
   Platforms take 500ms–2500ms to parse and display the uploaded file chip. The injector actively polls the DOM for completion chips:
   - Claude: `[data-testid="file-chip"]`, `div[class*="AttachmentPreview"]`
   - ChatGPT: `[data-testid="attachment-item"]`, `div[class*="file-item"]`
   - Gemini: `uploader-file-chip`, `div[class*="attachment-chip"]`

4. **Companion Prompt Typing:**
   Once the file is verified as attached, the companion prompt is typed into the compose box:
   > *"Please review the attached context-con_01.md (Context ID: con_01) and continue from where we left off..."*

---

## 📝 Mode 2: Fallback Text Injection & SPA State Sync

If the target platform does not support file attachments (or file simulation is rejected), the injector falls back to direct text entry.

### The Challenge of Modern SPAs
Modern frameworks like React (used by ChatGPT and Claude) and Angular (used by Gemini) track form inputs using internal Virtual DOM state. Simply setting `input.value = "..."` is immediately cleared when the framework re-renders.

### The 4-Step Bypass:

1. **Synthetic Focus:** Focuses and simulates a user pointer click on the target element.
2. **`document.execCommand` Insertion:**
   ```javascript
   document.execCommand('insertText', false, text);
   ```
   This triggers the framework's native input listeners in most browsers.
3. **Native Prototype Setter Fallback:**
   If `execCommand` fails or the element is not updated, the script accesses the underlying HTML prototype setter directly from the browser window:
   ```javascript
   const setter = Object.getOwnPropertyDescriptor(
     window.HTMLTextAreaElement.prototype,
     'value'
   ).set;
   setter.call(targetElement, text);
   ```
4. **Synthetic Bubble Event Dispatching:**
   The script fires `input` and `change` events with event bubbling enabled:
   ```javascript
   targetElement.dispatchEvent(new Event('input', { bubbles: true }));
   targetElement.dispatchEvent(new Event('change', { bubbles: true }));
   ```

---

## 🎨 Isolated Shadow DOM Confirmation Card

To give users visual feedback without styling conflicts, Cross Context mounts an overlay inside a custom **Shadow Root**:

- **Style Isolation:** Page CSS cannot break the extension's badge layouts or button fonts.
- **Visual Mode Badges:**
  - `📄 Attached context-con_01.md` (Green glowing badge)
  - `📝 Text Paste Fallback` (Amber glowing badge)
- **Auto-Dismiss / Manual Cancel:** Includes a 1200ms countdown timer and a quick "Cancel" button allowing users to review the handoff before submitting.
