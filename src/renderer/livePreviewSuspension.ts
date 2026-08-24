type SuspensionListener = (suspended: boolean) => void;

let suspensionCount = 0;
const listeners = new Set<SuspensionListener>();

function notifyListeners() {
  const suspended = suspensionCount > 0;
  listeners.forEach((listener) => listener(suspended));
}

export function isLivePreviewRenderingSuspended(): boolean {
  return suspensionCount > 0;
}

export function subscribeToLivePreviewSuspension(listener: SuspensionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Ref-counting keeps independent export/lifecycle callers from resuming the
// preview until every suspension they acquired has been released.
export function suspendLivePreviewRendering(): () => void {
  suspensionCount++;
  if (suspensionCount === 1) notifyListeners();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    suspensionCount = Math.max(0, suspensionCount - 1);
    if (suspensionCount === 0) notifyListeners();
  };
}
