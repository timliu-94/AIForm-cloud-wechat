const INITIAL_PROGRESS = 8;
const GENERATING_DURATION = 10000;
const GENERATING_TARGET = 90;
const WAITING_TARGET = 96;
const WAITING_STEP_DURATION = 3000;
const TICK_INTERVAL = 250;

function setProgress(page, progress) {
  if (!page || progress === page.data.exportProgress) return;
  page.setData({
    exportProgress: progress,
    exportProgressStyle: `width: ${progress}%;`,
  });
}

function advanceProgress(page) {
  const elapsed = Date.now() - page._exportProgressStartedAt;
  let progress;
  if (elapsed <= GENERATING_DURATION) {
    progress = INITIAL_PROGRESS + Math.floor(
      (GENERATING_TARGET - INITIAL_PROGRESS) * elapsed / GENERATING_DURATION,
    );
  } else {
    progress = GENERATING_TARGET + Math.floor(
      (elapsed - GENERATING_DURATION) / WAITING_STEP_DURATION,
    );
  }
  if (page.data.exportProgressStage === 'downloading') progress = Math.max(progress, 94);
  setProgress(page, Math.min(progress, WAITING_TARGET));
}

function showExportProgress(page, stage) {
  if (!page) return;
  if (!page._exportProgressTimer) {
    page._exportProgressStartedAt = Date.now();
    page._exportProgressTimer = setInterval(() => advanceProgress(page), TICK_INTERVAL);
    page.setData({
      exportProgressVisible: true,
      exportProgressStage: stage,
      exportProgress: INITIAL_PROGRESS,
      exportProgressStyle: `width: ${INITIAL_PROGRESS}%;`,
    });
    return;
  }
  page.setData({ exportProgressStage: stage });
  if (stage === 'downloading') setProgress(page, Math.max(page.data.exportProgress, 94));
}

function hideExportProgress(page) {
  if (!page) return;
  if (page._exportProgressTimer) {
    clearInterval(page._exportProgressTimer);
    page._exportProgressTimer = null;
  }
  page._exportProgressStartedAt = null;
  if (page._pageActive !== false) page.setData({ exportProgressVisible: false });
}

module.exports = {
  hideExportProgress,
  showExportProgress,
};
