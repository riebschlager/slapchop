// Shared gutter for the workspace: the same margin fits the artboard to the
// window (CanvasWorkspace's scale calc) and keeps pinned handles off the
// canvas edge (getVisibleHandleBounds). One constant so the two cannot drift
// apart as the shell around the canvas changes.
export const WORKSPACE_FIT_MARGIN = 40;
