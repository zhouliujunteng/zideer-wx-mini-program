const { columnWidth, LARGE_SCREEN_WIDE_COLUMN, isLargeScreen } = require('./screen')

// Share the actual canvas and panel bounds: visual projection and touch hit testing
// must use the same rectangle as the rendered viewport.
function tabletStage(windowWidth, windowHeight, contentTop, bottomInset) {
  if (!isLargeScreen(windowWidth)) return null
  const width = columnWidth(windowWidth, LARGE_SCREEN_WIDE_COLUMN)
  const height = Math.max(160, windowHeight - contentTop - bottomInset - 12)
  const sidebar = width >= 600
  const panelWidth = sidebar ? Math.min(300, Math.max(220, Math.round(width * .34))) : width - 24
  const panelHeight = sidebar ? height : Math.min(260, Math.round(height * .42))
  const stageWidth = sidebar ? width - panelWidth - 12 : width
  const stageHeight = sidebar ? height : height - panelHeight - 12
  return {
    sidebar, stageWidth, stageHeight,
    panelLeft: sidebar ? stageWidth + 12 : 12,
    panelTop: sidebar ? contentTop : contentTop + stageHeight + 12,
    panelWidth, panelHeight,
    visualEnd: contentTop + stageHeight
  }
}

module.exports = { tabletStage }
