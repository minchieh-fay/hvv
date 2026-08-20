// 读取指定日期的本地参考图片列表。
export async function listReferences(date) {
    const response = await fetch(`/api/images/references?date=${encodeURIComponent(date)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '读取参考图失败');
    return result;
}

// 保存剪贴板或本地文件中的图片。
export async function saveReference(dataURL, name = '') {
    const response = await fetch('/api/images/references', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({dataURL, name}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '保存参考图失败');
    return result;
}

// 删除图片库中的本地图片。
export async function deleteReference(path) {
    const response = await fetch(`/api/images/references?path=${encodeURIComponent(path)}`, {method: 'DELETE'});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '删除图片失败');
    return result;
}

// 读取 Agent 工具调用 Agnes 所需的设置。
export async function loadImageToolContext() {
    const settingsResponse = await fetch('/api/settings');
    const settings = await settingsResponse.json();
    if (!settingsResponse.ok) throw new Error('读取图片工具配置失败');
    return {settings};
}

// 将本地图片读取为可直接发送给 Agnes 的 Data URI。
async function readImageDataURL(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// 根据图片来源准备 Agnes 图生图的输入内容。
async function buildImageInputs(paths, context) {
    return await Promise.all(paths.map(async path => {
        const reference = context.references.find(item => item.path === path);
        if (!reference) throw new Error('参考图不存在');
        return reference.generated ? reference.url : await readImageDataURL(reference.url);
    }));
}

// 调用 Agnes 官方图片生成 API，作为 Agent 的图片生成工具实现。
export async function callAgnesImageTool(payload, context, signal) {
    const references = payload.references || [];
    const images = await buildImageInputs(references, context);
    const requestBody = {...payload, model: 'agnes-image-2.1-flash', references: undefined,
        extra_body: {response_format: 'url', ...(images.length ? {image: images} : {})}};
    const response = await fetch(`${context.settings.baseURL}/images/generations`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${context.settings.apiKey}`}, body: JSON.stringify(requestBody), signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '图片生成失败');
    const item = result.data?.[0];
    if (!item?.url) throw new Error('Agnes 没有返回图片地址');
    return item.url;
}

// 将 Agent 工具生成的官方图片地址交给 Go 保存到图片库。
export async function saveImageResult(url) {
    const response = await fetch('/api/images/results', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '保存生成图片失败');
    return result;
}
