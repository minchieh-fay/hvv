// 根据有效片段生成单播放器预览所需的时间映射。
export function buildPreviewTimeline(segments) {
  let total = 0;
  return segments
    .filter((item) => item.status === "completed" && item.url)
    .map((segment) => {
      const start = total;
      total += Number(segment.actualDuration || segment.targetDuration || 0);
      return { ...segment, previewStart: start, previewEnd: total };
    });
}

// 将播放器总时间映射到具体片段和片段内时间。
export function locatePreviewTime(timeline, globalTime) {
  const current =
    timeline.find((item) => globalTime >= item.previewStart && globalTime <= item.previewEnd) ||
    timeline[timeline.length - 1];
  if (!current) return null;
  return { segment: current, localTime: Math.max(0, globalTime - current.previewStart) };
}
