// 将秒数转换为 Agnes 要求的合法帧数和实际时长。
export function help_framePlan(seconds: number) {
  const target = Math.max(2, Number(seconds) || 2);
  const count = Math.max(1, Math.min(55, Math.ceil(target / 5)));
  const piece = Math.max(2, Math.min(5, target / count));
  const n = Math.max(2, Math.round((piece * 24 - 1) / 8));
  const numFrames = Math.min(441, 8 * n + 1);
  return { targetSeconds: piece, numFrames, actualSeconds: numFrames / 24 };
}

// 按中文正常口播速度估算台词时长，并加入标点产生的自然停顿。
export function help_speechSeconds(dialogue: string) {
  const text = String(dialogue || "");
  const spokenLength = text.replace(/[\s，。！？、,.!?；：;:]/g, "").length;
  const shortPauseCount = (text.match(/[，、；：,;:]/g) || []).length;
  const sentencePauseCount = (text.match(/[。！？.!?]/g) || []).length;
  return spokenLength / 6 + shortPauseCount * 0.25 + sentencePauseCount * 0.5;
}

// 将长台词按句子和标点拆成适合单个视频片段的连续台词。
function help_splitDialogue(dialogue: string, maxSeconds: number) {
  const text = String(dialogue || "").trim();
  if (!text) return [];
  const sentences = text.match(/[^。！？.!?]+[。！？.!?]?/g) || [text];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = `${current}${sentence}`;
    if (current && help_speechSeconds(candidate) > maxSeconds) {
      parts.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.flatMap((part) => help_splitLongDialogue(part, maxSeconds));
}

// 将单句过长台词按标点或字符边界继续拆分，避免压缩正常语速。
function help_splitLongDialogue(dialogue: string, maxSeconds: number) {
  if (help_speechSeconds(dialogue) <= maxSeconds) return [dialogue];
  const pieces = dialogue.split(/(?<=[，、；：,;:])/g).filter(Boolean);
  if (pieces.length > 1) {
    return help_mergeDialoguePieces(pieces, maxSeconds).flatMap((piece) =>
      help_splitLongDialogue(piece, maxSeconds),
    );
  }
  const maxLength = Math.max(1, Math.floor(maxSeconds * 6));
  return Array.from({ length: Math.ceil(dialogue.length / maxLength) }, (_, index) =>
    dialogue.slice(index * maxLength, (index + 1) * maxLength).trim(),
  ).filter(Boolean);
}

// 将标点片段合并到接近目标时长，保持台词顺序不变。
function help_mergeDialoguePieces(pieces: string[], maxSeconds: number) {
  const result: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = `${current}${piece}`;
    if (current && help_speechSeconds(candidate) > maxSeconds) {
      result.push(current.trim());
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

// 将一个剧本章节拆成不会超过五秒且台词不重复的连续片段。
export function help_splitScene(scene: any) {
  const duration = Math.max(0.01, Number(scene.duration) || 0);
  const dialogueParts = help_splitDialogue(scene.dialogue || "", 3.8);
  const count = dialogueParts.length || Math.max(1, Math.ceil(duration / 5));
  return Array.from({ length: count }, (_, index) => ({
    id: `${scene.id}-part-${String(index + 1).padStart(2, "0")}`,
    sceneIds: [scene.id],
    sourceScene: scene,
    partIndex: index,
    partCount: count,
    ...help_framePlan(
      dialogueParts[index]
        ? Math.max(2, help_speechSeconds(dialogueParts[index]) + 0.8)
        : Math.min(5, duration / count),
    ),
    dialogue: dialogueParts[index] || "",
  }));
}

// 生成 Agent 使用的可执行分段计划，并保留每段的剧情来源。
export function help_buildSegmentPlan(scenes: any[]) {
  return scenes.flatMap(help_splitScene).map((segment, index, all) => ({
    ...segment,
    index: index + 1,
    nextSegmentId: all[index + 1]?.id || "",
    action: segment.sourceScene.action,
    dialogue: segment.dialogue,
    characters: segment.sourceScene.characters || [],
    objects: segment.sourceScene.objects || [],
  }));
}
