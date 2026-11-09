// 多行输入框按文字量估高度（单位 rpx），代替 textarea 的 auto-height。
// auto-height 在长文本（如十几行的证明题）上会把高度算大好几倍，下面留一大片空白（2026-10-09 电脑版微信错因诊断页）。
// 估算只看字数：中文按一个字宽、ASCII 按半个多字宽折行，宁可略高一行；超过 maxRpx 时输入框固定这么高、里面滚动。

function charWidth(code) {
  return code < 0x2e80 ? 0.56 : 1
}

function estimateLines(text, charsPerLine) {
  return String(text || '').split('\n').reduce((total, line) => {
    let width = 0
    for (const char of line) width += charWidth(char.codePointAt(0))
    return total + Math.max(1, Math.ceil(width / charsPerLine))
  }, 0)
}

// widthRpx：输入框内容区宽度（去掉内边距）；fontRpx、lineHeight 与样式一致；paddingRpx 是上下内边距之和。
function textareaHeightRpx(text, { widthRpx, fontRpx, lineHeight, paddingRpx, minRpx, maxRpx }) {
  const lines = estimateLines(text, Math.max(1, Math.floor(widthRpx / fontRpx))) + 1
  const height = Math.ceil(lines * fontRpx * lineHeight + paddingRpx)
  return Math.min(maxRpx, Math.max(minRpx, height))
}

module.exports = { estimateLines, textareaHeightRpx }
