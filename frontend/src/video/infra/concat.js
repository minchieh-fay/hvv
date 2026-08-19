import { createFile } from "mp4box";

// 将多个相同编码参数的 MP4 片段在浏览器中重新封装为一个 MP4。
export async function concatMp4Segments(urls) {
  if (!urls.length) throw new Error("没有可合成的视频片段");
  const parsed = await Promise.all(urls.map(parseMp4File));
  const first = parsed[0];
  const output = createFile();
  const outputTracks = new Map();
  for (const track of first.info.tracks) {
    const sourceTrack = first.file.getTrackById(track.id);
    const description = sourceTrack?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const id = output.addTrack({
      id: track.id,
      type: track.codec.split(".")[0],
      width: track.video?.width || 0,
      height: track.video?.height || 0,
      timescale: track.timescale,
      channel_count: track.audio?.channel_count,
      samplerate: track.audio?.sample_rate,
      samplesize: track.audio?.sample_size,
      description,
    });
    if (!id) throw new Error(`无法创建 ${track.codec} 轨道`);
    outputTracks.set(track.id, { id, time: 0 });
  }
  for (const parsedFile of parsed) {
    for (const track of parsedFile.info.tracks) {
      const target = outputTracks.get(track.id);
      if (!target) throw new Error("视频片段轨道不一致，无法合成");
      for (const sample of parsedFile.samples.get(track.id) || []) {
        const data = sample.data instanceof Uint8Array ? sample.data : new Uint8Array(sample.data);
        output.addSample(target.id, data, {
          duration: sample.duration,
          dts: target.time + sample.dts,
          cts: sample.cts,
          is_sync: sample.is_rap,
        });
      }
      const last = parsedFile.samples.get(track.id)?.at(-1);
      if (last) target.time += last.dts + last.duration;
    }
  }
  return output.save("hvv-video.mp4");
}

// 解析一个 MP4 文件并提取视频和音频 sample。
function parseMp4File(url) {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`读取片段失败：${url}`);
      const buffer = await response.arrayBuffer();
      const file = createFile();
      const samples = new Map();
      file.onError = (error) => reject(new Error(String(error)));
      file.onReady = (info) => {
        for (const track of info.tracks) {
          samples.set(track.id, []);
          file.setExtractionOptions(track.id, track.id, { nbSamples: 1000, rapAlignement: false });
        }
        file.onSamples = (trackID, _user, values) => samples.get(trackID)?.push(...values);
        file.start();
      };
      buffer.fileStart = 0;
      file.appendBuffer(buffer);
      file.flush();
      window.setTimeout(() => resolve({ file, info: file.getInfo(), samples }), 0);
    } catch (error) {
      reject(error);
    }
  });
}
