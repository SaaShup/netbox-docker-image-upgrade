const PROGRESS_TTL_MS = 15 * 60 * 1000;
const PROGRESS_TOTAL_STEPS = 5;

const entries = new Map();

function progressKey(value) {
  return String(value || "").trim().toLowerCase();
}

function pruneCreationProgress(now = Date.now()) {
  for (const [key, entry] of entries) {
    if (now - entry.at > PROGRESS_TTL_MS) entries.delete(key);
  }
}

function setCreationProgress(names, step, label) {
  pruneCreationProgress();
  const at = Date.now();
  (Array.isArray(names) ? names : [names]).forEach((name) => {
    const key = progressKey(name);
    if (key) entries.set(key, { step, total: PROGRESS_TOTAL_STEPS, label, at });
  });
}

function clearCreationProgress(names) {
  (Array.isArray(names) ? names : [names]).forEach((name) => {
    entries.delete(progressKey(name));
  });
}

function markCreationFailed(names) {
  pruneCreationProgress();
  const at = Date.now();
  (Array.isArray(names) ? names : [names]).forEach((name) => {
    const key = progressKey(name);
    if (key) entries.set(key, { failed: true, at });
  });
}

function creationProgressFor(name) {
  const entry = entries.get(progressKey(name));
  if (!entry || Date.now() - entry.at > PROGRESS_TTL_MS) return null;
  if (entry.failed) return { failed: true };
  return { step: entry.step, total: entry.total, label: entry.label };
}

module.exports = { setCreationProgress, clearCreationProgress, markCreationFailed, creationProgressFor, pruneCreationProgress };
