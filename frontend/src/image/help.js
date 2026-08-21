// 将图片模块的 1K 档位转换为视频模块统一使用的画布尺寸。
export function help_resolveImageSize(size, ratio) {
    if (size !== '1K') return size;
    if (ratio === '16:9') return '1024x576';
    if (ratio === '9:16') return '576x1024';
    if (ratio === '3:4') return '768x1024';
    if (ratio === '4:3') return '1024x768';
    return size;
}
