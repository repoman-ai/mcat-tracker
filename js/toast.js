export function createToastController(toast, document) {
  let timer;
  let undoButton = null;
  const dismiss = () => {
    if (toast.matches(":hover, :focus-within")) { timer = setTimeout(dismiss, 1000); return; }
    undoButton = null;
    toast.inert = true;
    toast.classList.remove("is-visible");
  };
  document.addEventListener("keydown", (event) => {
    if (!undoButton || event.defaultPrevented || event.repeat || event.shiftKey || event.altKey
      || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    // Preserve native text undo, including contenteditable and form controls.
    if (event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    event.preventDefault();
    undoButton.click();
  });
  return (message, tone = "success", action = null) => {
    clearTimeout(timer);
    undoButton = null;
    toast.textContent = message;
    toast.inert = false;
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toast__action";
      button.textContent = `${action.label} · Ctrl/⌘Z`;
      button.setAttribute("aria-keyshortcuts", "Control+Z Meta+Z");
      button.addEventListener("click", () => { undoButton = null; action.onClick(); }, { once: true });
      undoButton = button;
      toast.append(button);
    }
    toast.dataset.tone = tone;
    toast.classList.add("is-visible");
    timer = setTimeout(dismiss, action ? 10000 : 3200);
  };
}
