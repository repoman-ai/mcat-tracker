/** Run UI success effects only after a local write succeeds. */
export function createStateUpdater({ save, apply, render, sync, showToast }) {
  return (next, { notify = true, success = "", onSaved } = {}) => {
    let saved;
    try { saved = save(next, { notify }); }
    catch (error) {
      showToast(`Could not save locally: ${error.message}`, "error");
      return false;
    }
    apply(saved);
    onSaved?.(saved);
    if (notify) render();
    if (success) showToast(success);
    // A cloud scheduling error must never be described as a failed local save.
    try { sync(); }
    catch { showToast("Saved locally. Cloud sync could not be scheduled; try Sync now.", "error"); }
    return true;
  };
}
