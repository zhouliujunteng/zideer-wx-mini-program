// 数字按容器宽度自动缩小字号（2026-09-25，「我的」页积分、金币）：位数多时（如 200000）不撑出卡片。
// 容器宽度用实测值（手机、iPad 大屏都按实际可用宽度算）；数据到了先按字宽估算，渲染后再按实测文字宽度校正。

// 粗体字宽的估算（相对字号）：数字、字母、半角符号约 0.62em（留一点余量按 0.64 算），中文与全角符号 1em。
function estimateTextWidth(text, fontSize) {
  let em = 0
  for (const char of String(text == null ? '' : text)) em += char.charCodeAt(0) <= 0xFF ? 0.64 : 1
  return em * fontSize
}

// 返回要写到行内的字号；0 表示放得下、不用改（沿用样式里的原字号，大屏下也不会被 JS 算出的字号压小）。
function shrunkSize(size, baseSize, minSize) {
  if (size >= baseSize) return 0
  return Math.max(minSize, Math.floor(size * 10) / 10)
}

// 数据到了、还没渲染：按字宽估算。baseSize 是样式里的原字号，minSize 最小字号（单位都是 px）。
function fitFontSize(text, boxWidth, baseSize, minSize) {
  if (!boxWidth) return 0
  return shrunkSize(baseSize * boxWidth / estimateTextWidth(text, baseSize), baseSize, minSize)
}

// 渲染后校正：currentSize 是实际渲染的字号，textWidth 是实测文字宽。字宽与字号成正比，一次即可；数字变短时回到原字号。
function correctFontSize(currentSize, textWidth, boxWidth, baseSize, minSize) {
  return shrunkSize(currentSize * boxWidth / textWidth, baseSize, minSize)
}

module.exports = { estimateTextWidth, fitFontSize, correctFontSize }
