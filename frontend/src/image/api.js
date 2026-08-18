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

// 读取 Agent 工具调用 Agnes 所需的设置和本地媒体公网地址。
export async function loadImageToolContext() {
    const [settingsResponse, statusResponse] = await Promise.all([fetch('/api/settings'), fetch('/api/images/status')]);
    const settings = await settingsResponse.json();
    const status = await statusResponse.json();
    if (!settingsResponse.ok || !statusResponse.ok) throw new Error('读取图片工具配置失败');
    return {settings, publicURL: status.publicURL};
}

// 调用 Agnes 官方图片生成 API，作为 Agent 的图片生成工具实现。
export async function callAgnesImageTool(payload, context, signal) {
    const references = payload.references || [];
    const requestBody = {...payload, model: 'agnes-image-2.1-flash', references: undefined, extra_body: {response_format: 'b64_json', ...(references.length ? {image: references.map(path => `${context.publicURL}/media/${path}`)} : {})}};
    const response = await fetch(`${context.settings.baseURL}/images/generations`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${context.settings.apiKey}`}, body: JSON.stringify(requestBody), signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '图片生成失败');
    const item = result.data?.[0];
    if (!item?.b64_json) throw new Error('Agnes 没有返回 Base64 图片');
    return `data:image/png;base64,${item.b64_json}`;
}

// 将 Agent 工具生成的图片交给 Go 保存到本地媒体目录。
export async function saveImageResult(dataURL) {
    const response = await fetch('/api/images/results', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({dataURL})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '保存生成图片失败');
    return result;
}
