import { bindEditorDrafts } from "./editor-drafts.js";
import { enableSheetDismiss } from "./gestures.js";

/**
 * The one modal sheet the whole app shares. Opening, closing, and clearing run
 * through here so that clearing can never race a reopen.
 */
export function createDialogController(dialog, { document = dialog.ownerDocument, view = globalThis } = {}) {
  const heading = dialog.querySelector("#dialog-title");
  const body = dialog.querySelector("[data-dialog-body]");
  let previousFocus = null;
  let unbindSheet = () => {};

  // `close` is dispatched from a queued task, not synchronously from close(),
  // so it can land after the sheet has already been reopened with new content.
  // Clearing therefore has to check that the sheet is still shut.
  const release = () => {
    if (dialog.open) return;
    unbindSheet();
    body.innerHTML = "";
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  };

  const open = ({ title, body: content, onMount }) => {
    // Replacing one sheet with another keeps the control that opened the first
    // one as the focus target, so closing the second still lands where the user
    // started rather than on whatever opened the sheet they were replacing.
    unbindSheet();
    if (!dialog.open && !previousFocus) previousFocus = document.activeElement;
    heading.textContent = title;
    body.innerHTML = content;
    dialog.scrollTop = 0;
    if (!dialog.open) dialog.showModal();
    unbindSheet = enableSheetDismiss(dialog, { view, onDismiss: close });
    onMount?.(dialog);
    bindEditorDrafts(dialog);
    dialog.querySelector("button, a, input, select, textarea")?.focus();
  };

  const close = () => { unbindSheet(); dialog.close(); };
  dialog.querySelector("[data-dialog-close]")?.addEventListener("click", close);
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog.open) {
      event.preventDefault();
      close();
    }
  });
  dialog.addEventListener("close", release);

  return { open, release, close, get isOpen() { return dialog.open; } };
}
