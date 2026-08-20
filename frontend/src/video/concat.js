import { createFile } from "mp4box";

// 将多个相同编码参数的 MP4 片段在浏览器中重新封装为一个文件。
export async function concatMp4Segments(urls) {
  if (!urls.length) throw new Error("没有可合成的视频片段");
  const parsed = await Promise.all(urls.map(help_parseMp4File));
  const first = parsed[0];
  const output = createFile();
  const outputTracks = new Map();
  for (const track of first.info.tracks) {
    const sourceTrack = first.file.getTrackById(track.id);
    const sourceEntry = sourceTrack?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    if (!sourceEntry) throw new Error("视频轨道缺少编码描述");
    const isAudio = track.codec.startsWith("mp4a");
    const id = output.addTrack({
      id: track.id,
      type: sourceEntry.type,
      hdlr: isAudio ? "soun" : "vide",
      width: track.video?.width || 0,
      height: track.video?.height || 0,
      timescale: track.timescale,
      channel_count: track.audio?.channel_count,
      samplerate: track.audio?.sample_rate,
      samplesize: track.audio?.sample_size,
      description_boxes: sourceEntry.boxes || [],
    });
    if (!id) throw new Error("无法创建 MP4 轨道");
    outputTracks.set(track.id, { id, time: 0 });
  }
  for (const parsedFile of parsed) {
    for (const track of parsedFile.info.tracks) {
      const target = outputTracks.get(track.id);
      if (!target) throw new Error("视频片段轨道不一致，无法合成");
      for (const sample of parsedFile.samples.get(track.id) || []) {
        const data =
          sample.data instanceof Uint8Array
            ? sample.data
            : new Uint8Array(sample.data);
        output.addSample(target.id, data, {
          duration: sample.duration,
          dts: target.time + sample.dts,
          // cts 是显示时间戳，也必须加上当前片段的时间偏移。
          cts: target.time + sample.cts,
          is_sync: sample.is_rap,
        });
      }
      const samples = parsedFile.samples.get(track.id) || [];
      const last = samples.at(-1);
      if (last) target.time += last.dts + last.duration;
    }
  }
  const sampleCounts = parsed.map((parsedFile) =>
    [...parsedFile.samples.entries()].map(([trackID, values]) => ({
      trackID,
      count: values.length,
    })),
  );
  console.log("[hvv video] mp4 samples extracted", sampleCounts);
  const stream = output.getBuffer();
  const bytes = new Uint8Array(
    stream.buffer,
    stream.byteOffset,
    stream.byteLength,
  );
  const outputBytes = new Uint8Array(bytes);
  console.log("[hvv video] mp4 output buffer", {
    byteLength: outputBytes.byteLength,
    tracks: outputTracks.size,
  });
  const blob = new Blob([outputBytes], { type: "video/mp4" });
  if (!blob.size) throw new Error("MP4 合成结果为空");
  return blob;
}

// 读取 MP4 文件并提取所有音视频 sample。
function help_parseMp4File(url) {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("读取视频片段失败");
      const buffer = await response.arrayBuffer();
      const file = createFile();
      const samples = new Map();
      let idleTimer;
      let fallbackTimer;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(idleTimer);
        window.clearTimeout(fallbackTimer);
        resolve({ file, info: file.getInfo(), samples });
      };
      file.onError = (error) => reject(new Error(String(error)));
      file.onReady = (info) => {
        for (const track of info.tracks) {
          samples.set(track.id, []);
          file.setExtractionOptions(track.id, track.id, {
            nbSamples: 1000,
            rapAlignement: false,
          });
        }
        file.onSamples = (trackID, _user, values) => {
          samples.get(trackID)?.push(...values);
          window.clearTimeout(idleTimer);
          idleTimer = window.setTimeout(finish, 150);
        };
        file.start();
        fallbackTimer = window.setTimeout(finish, 3000);
      };
      buffer.fileStart = 0;
      file.appendBuffer(buffer);
      file.flush();
    } catch (error) {
      reject(error);
    }
  });
}
