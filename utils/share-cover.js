// 小程序分享卡片的封面（发给微信好友时卡片里那张图）：微信建议 5:4，这里按 500×400 排版、2 倍像素导出。
// 一套版式，三处在用（2026-10-04）：操作指南（account/help-guide）、老师发给学生的专属诊断会议
// （teacher/student-detail、learning/agent-invite）、邀请好友（agent/poster-detail、agent/share-link）。
// 底图是千问生成的大图（后端素材 help/share-cover.jpg：四周 3D 学习小元素、中间留白），
// 中间自上而下叠：知鹿学习 Logo（home/brand-logo.png，与首页顶栏同一张）、一枚 3D 图标、
// 可选的一行橙色小标题（学生名字等）、大标题、一枚白色胶囊说明。
// 图片由 services/share-cover.js 先下载到本地再交进来；哪张没读到就不画哪张，不拿别的东西顶替 Logo。
// 封面上不画手机（用户 2026-10-04 要求）。

const COVER_WIDTH = 500
const COVER_HEIGHT = 400
const COVER_SCALE = 2
const FONT = '"PingFang SC", "Helvetica Neue", sans-serif'
const LOGO_HEIGHT = 36
const LOGO_GAP = 22
const ICON_SIZE = 116
// 有小标题时图标缩一点，整体仍落在底图中间的留白里
const ICON_SIZE_WITH_KICKER = 100
const ICON_GAP = 10
const KICKER_LINE = 34
const TITLE_LINE = 46
const TITLE_WIDTH = 330
const PILL_GAP = 14
const PILL_HEIGHT = 38

// 封面要画的后端素材：底图和 Logo 固定，图标各处自己选。
// 都按包内路径写（/assets/…），素材键取最后一个 assets/ 之后的部分，scripts/verify-ui-assets.mjs 才扫得到
const COVER_BACKGROUND = '/assets/help/share-cover.jpg'
const COVER_LOGO = '/assets/home/brand-logo.png'

function assetKey(path) {
  return String(path || '').replace(/^.*assets\//, '')
}

function coverAssetKeys(iconPath) {
  return { background: assetKey(COVER_BACKGROUND), logo: assetKey(COVER_LOGO), icon: assetKey(iconPath) }
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function fillRound(ctx, x, y, width, height, radius, color) {
  roundRect(ctx, x, y, width, height, radius)
  ctx.fillStyle = color
  ctx.fill()
}

// 按宽度折行，最多 maxLines 行，超出的最后一行末尾换成「…」
function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = []
  let line = ''
  for (const char of String(text || '')) {
    if (ctx.measureText(line + char).width > maxWidth && line) {
      lines.push(line)
      line = char
      if (lines.length === maxLines) break
    } else {
      line += char
    }
  }
  if (lines.length < maxLines && line) lines.push(line)
  const used = lines.join('').length
  if (used < String(text || '').length && lines.length) {
    let last = lines[lines.length - 1]
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1)
    lines[lines.length - 1] = `${last}…`
  }
  return lines
}

function drawBackground(ctx, background) {
  if (background) {
    ctx.drawImage(background, 0, 0, COVER_WIDTH, COVER_HEIGHT)
    return
  }
  // 底图没读到：同色渐变兜底
  const gradient = ctx.createLinearGradient(0, 0, COVER_WIDTH, COVER_HEIGHT)
  gradient.addColorStop(0, '#FFE1C2')
  gradient.addColorStop(1, '#FFF6EC')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT)
}

// text：{ kicker, title, label }，kicker（大标题上面那行橙字）和 label（胶囊）可以不给；
// images：{ background, logo, icon }，都是画布图片对象或 null；logo 带 width / height 用来算比例
function drawShareCover(ctx, text = {}, images = {}) {
  const { background, logo, icon } = images
  const center = COVER_WIDTH / 2
  const iconSize = text.kicker ? ICON_SIZE_WITH_KICKER : ICON_SIZE
  ctx.save()
  drawBackground(ctx, background)

  ctx.font = `700 26px ${FONT}`
  const kicker = text.kicker ? wrapText(ctx, text.kicker, TITLE_WIDTH, 1)[0] : ''
  ctx.font = `700 36px ${FONT}`
  const lines = wrapText(ctx, text.title, TITLE_WIDTH, 2)
  const label = String(text.label || '')
  const parts = [
    logo ? LOGO_HEIGHT + LOGO_GAP : 0,
    icon ? iconSize + ICON_GAP : 0,
    kicker ? KICKER_LINE : 0,
    lines.length * TITLE_LINE,
    label ? PILL_GAP + PILL_HEIGHT : 0
  ]
  let y = Math.round((COVER_HEIGHT - parts.reduce((sum, value) => sum + value, 0)) / 2)

  if (logo) {
    const logoWidth = Math.round(LOGO_HEIGHT * (logo.width / logo.height || 2.5))
    ctx.drawImage(logo, center - logoWidth / 2, y, logoWidth, LOGO_HEIGHT)
    y += LOGO_HEIGHT + LOGO_GAP
  }
  if (icon) {
    ctx.drawImage(icon, center - iconSize / 2, y, iconSize, iconSize)
    y += iconSize + ICON_GAP
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  if (kicker) {
    ctx.fillStyle = '#C25A02'
    ctx.font = `700 26px ${FONT}`
    ctx.fillText(kicker, center, y + 2)
    y += KICKER_LINE
  }
  ctx.fillStyle = '#24332D'
  ctx.font = `700 36px ${FONT}`
  lines.forEach((line, index) => ctx.fillText(line, center, y + index * TITLE_LINE + 4))
  y += lines.length * TITLE_LINE

  if (label) {
    y += PILL_GAP
    ctx.font = `600 17px ${FONT}`
    const pillWidth = ctx.measureText(label).width + 40
    fillRound(ctx, center - pillWidth / 2, y, pillWidth, PILL_HEIGHT, PILL_HEIGHT / 2, 'rgba(255, 255, 255, 0.92)')
    ctx.fillStyle = '#C25A02'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, center, y + 20)
  }
  ctx.restore()
}

// 操作指南：标题 + 「操作指南 · 共 N 步」
function guideCoverText(guide) {
  return { title: guide.title, label: `操作指南 · 共 ${guide.steps.length} 步` }
}

function drawGuideCover(ctx, guide, images = {}) {
  drawShareCover(ctx, guideCoverText(guide), images)
}

module.exports = {
  COVER_WIDTH,
  COVER_HEIGHT,
  COVER_SCALE,
  coverAssetKeys,
  drawShareCover,
  drawGuideCover,
  guideCoverText,
  wrapText
}
