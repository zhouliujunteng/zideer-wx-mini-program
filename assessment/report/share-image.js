// 测评报告分享长图（设计稿 ui-ref M17 的分享弹窗）：用旧版 Canvas 上下文按页面的层级把整份报告画成一张 PNG。
// 同一个函数跑两遍：第一遍只为量出总高度（不调用 draw，画布上什么也不会出现），页面按这个高度设好画布再画第二遍导出。
// 图片（头像、章节图标）必须是本地路径，由页面先用 getImageInfo 下载好；没下载到就不画，不影响生成。

const { radarLabelLines } = require('../../utils/assessment-report')

const PAGE_BG = '#FAFAFA'
const CLOSING = /[，。、；：！？）」』”’》,.;:!?)]/
const INK = '#303A34'

function painter(ctx) {
  const roundedPath = (x, top, w, h, radii) => {
    const [topLeft, topRight, bottomRight, bottomLeft] = radii
    ctx.beginPath()
    ctx.moveTo(x + topLeft, top)
    ctx.lineTo(x + w - topRight, top)
    ctx.arcTo(x + w, top, x + w, top + topRight, topRight)
    ctx.lineTo(x + w, top + h - bottomRight)
    ctx.arcTo(x + w, top + h, x + w - bottomRight, top + h, bottomRight)
    ctx.lineTo(x + bottomLeft, top + h)
    ctx.arcTo(x, top + h, x, top + h - bottomLeft, bottomLeft)
    ctx.lineTo(x, top + topLeft)
    ctx.arcTo(x, top, x + topLeft, top, topLeft)
    ctx.closePath()
  }
  const roundRect = (x, top, w, h, radius, color) => {
    roundedPath(x, top, w, h, [radius, radius, radius, radius])
    ctx.setFillStyle(color)
    ctx.fill()
  }
  const hex = (color) => [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16))
  const mix = (from, to, progress) => `#${from.map((value, channel) => Math.round(value + (to[channel] - value) * progress).toString(16).padStart(2, '0')).join('')}`
  // 旧版画布没有渐变裁切，按竖条逐段填色模拟横向渐变。
  const gradientShape = (x, top, w, h, radii, firstColor, lastColor) => {
    const from = hex(firstColor)
    const to = hex(lastColor)
    ctx.save()
    roundedPath(x, top, w, h, radii)
    ctx.clip()
    for (let index = 0; index < 32; index += 1) {
      ctx.setFillStyle(mix(from, to, index / 31))
      ctx.fillRect(x + index * w / 32, top, w / 32 + 1, h)
    }
    ctx.restore()
  }
  const text = (value, x, top, size, color, align = 'left') => {
    ctx.setTextAlign(align)
    ctx.setTextBaseline('top')
    ctx.setFillStyle(color)
    ctx.setFontSize(size)
    ctx.fillText(String(value == null ? '' : value), x, top)
  }
  const width = (value, size) => {
    ctx.setFontSize(size)
    return ctx.measureText(String(value == null ? '' : value)).width
  }
  const fit = (value, maxWidth, size) => {
    const content = String(value == null ? '' : value)
    if (width(content, size) <= maxWidth) return content
    let fitted = content
    while (fitted && width(`${fitted}…`, size) > maxWidth) fitted = fitted.slice(0, -1)
    return fitted ? `${fitted}…` : ''
  }
  // 按宽度折行，最多 maxLines 行（最后一行放不下时加省略号）。句读不放到行首：宁可让这一行略宽一点。
  const lines = (value, maxWidth, size, maxLines = 4) => {
    const rows = []
    let line = ''
    Array.from(String(value || '')).forEach((char) => {
      if (line && !CLOSING.test(char) && width(line + char, size) > maxWidth) {
        rows.push(line)
        line = char
      } else line += char
    })
    if (line) rows.push(line)
    if (rows.length <= maxLines) return rows
    const kept = rows.slice(0, maxLines)
    kept[maxLines - 1] = fit(kept[maxLines - 1] + rows.slice(maxLines).join(''), maxWidth, size)
    return kept
  }
  const hexMix = (firstColor, lastColor, progress) => mix(hex(firstColor), hex(lastColor), progress)
  return { roundedPath, roundRect, gradientShape, text, width, fit, lines, hexMix }
}

function drawRadar(ctx, p, dimensions, cx, cy, radius, bounds) {
  const count = dimensions.length
  const point = (index, ratio) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count
    return { x: cx + Math.cos(angle) * radius * ratio, y: cy + Math.sin(angle) * radius * ratio }
  }
  const polygon = (ratioAt) => {
    ctx.beginPath()
    dimensions.forEach((item, index) => {
      const vertex = point(index, ratioAt(item))
      if (!index) ctx.moveTo(vertex.x, vertex.y)
      else ctx.lineTo(vertex.x, vertex.y)
    })
    ctx.closePath()
  }
  ctx.setLineWidth(1)
  for (let ring = 1; ring <= 4; ring += 1) {
    polygon(() => ring / 4)
    ctx.setStrokeStyle(ring === 4 ? 'rgba(207,120,125,0.35)' : 'rgba(207,120,125,0.19)')
    ctx.stroke()
  }
  dimensions.forEach((item, index) => {
    const vertex = point(index, 1)
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(vertex.x, vertex.y)
    ctx.setStrokeStyle('rgba(207,120,125,0.20)')
    ctx.stroke()
  })
  const ratio = (item) => Math.max(0, Math.min(100, item.value)) / 100
  polygon(ratio)
  ctx.setFillStyle('rgba(242,99,104,0.18)')
  ctx.fill()
  ctx.setStrokeStyle('#F26368')
  ctx.setLineWidth(2)
  ctx.stroke()
  dimensions.forEach((item, index) => {
    const vertex = point(index, ratio(item))
    ctx.beginPath()
    ctx.arc(vertex.x, vertex.y, 2.5, 0, Math.PI * 2)
    ctx.setFillStyle(item.color)
    ctx.fill()
    const label = point(index, 1.25)
    const align = label.x < cx - 8 ? 'right' : label.x > cx + 8 ? 'left' : 'center'
    const room = align === 'left' ? bounds.right - label.x : align === 'right' ? label.x - bounds.left : bounds.right - bounds.left
    const lines = radarLabelLines(item.label, room - 2, (value) => p.width(value, 9))
    const shift = (lines.length - 1) * 5.5
    lines.forEach((line, lineIndex) => p.text(line, label.x, label.y - 10 - shift + lineIndex * 11, 9, '#75666B', align))
    p.text(`${item.value}%`, label.x, label.y + 2 + shift, 8, item.color, align)
  })
}

// 画整张长图，返回用到的总高度（逻辑像素）。options：{ width, height（第二遍才有）, topInset, scale, images: { avatar, mastery, weak, path } }
function drawReportShare(ctx, model, options) {
  const p = painter(ctx)
  const images = options.images || {}
  const width = options.width
  const topInset = options.topInset
  const left = 14
  const right = width - 14
  const innerWidth = right - left
  let y = 0

  ctx.scale(options.scale || 1, options.scale || 1)
  ctx.setFillStyle(PAGE_BG)
  ctx.fillRect(0, 0, width, options.height || 6000)
  // 顶部浅粉红，向下渐隐到页面灰底（与页面顶栏同一组颜色）。
  for (let index = 0; index < 34; index += 1) {
    const progress = index / 33
    const color = progress < 0.52 ? p.hexMix('#FBE5E5', '#FCEDEE', progress / 0.52) : p.hexMix('#FCEDEE', PAGE_BG, (progress - 0.52) / 0.48)
    ctx.setFillStyle(color)
    ctx.fillRect(0, index * 10, width, 11)
  }
  // 背景铺到最顶，第一行内容避开刘海。
  ctx.translate(0, topInset)

  const section = (title, top, iconKey) => {
    if (iconKey && images[iconKey]) {
      ctx.save()
      ctx.setGlobalAlpha(0.4)
      ctx.drawImage(images[iconKey], right - 80, top - 10, 76, 62)
      ctx.restore()
    }
    return () => {
      const pillWidth = Math.min(innerWidth, p.width(title, 14) + 27)
      p.gradientShape(left, top, pillWidth, 31, [17, 7, 17, 4], '#F66D66', '#F04F4F')
      p.text(title, left + 14, top + 8, 14, '#FFFFFF')
    }
  }

  // 学生头像与姓名
  if (images.avatar) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(left + 27, 27, 23, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(images.avatar, left + 4, 4, 46, 46)
    ctx.restore()
  } else {
    ctx.beginPath()
    ctx.arc(left + 27, 27, 23, 0, Math.PI * 2)
    ctx.setFillStyle('#FFFFFF')
    ctx.fill()
  }
  p.text(p.fit(model.student.name, innerWidth - 70, 19), left + 62, 17, 19, INK)
  y = 58

  if (!model.timingOnly) {
  // 成绩卡（左分数、右雷达）与下层建议条
  const coverTop = y
  const hasRadar = model.radar.length >= 3
  const coverHeight = hasRadar ? 201 : 138
  const coverPadding = 17
  const contentLeft = left + coverPadding
  const contentWidth = innerWidth - coverPadding * 2
  const scoreWidth = hasRadar ? contentWidth * 0.37 : contentWidth
  p.gradientShape(left + 7, coverTop + coverHeight - 5, innerWidth - 14, 38, [0, 0, 12, 12], '#FF7779', '#F45B60')
  p.roundRect(left, coverTop, innerWidth, coverHeight, 20, '#FFFFFF')
  const scoreTop = hasRadar ? coverTop + 27 : coverTop + 20
  p.text('综合掌握度', contentLeft, scoreTop, 10, '#818AA0')
  const totalLabel = `/ ${model.cover.totalScore}`
  const totalWidth = p.width(totalLabel, 14)
  const fullWidth = p.width(model.cover.scoreText, 39)
  const scoreSize = Math.min(39, Math.floor(39 * (scoreWidth - totalWidth - 9) / Math.max(fullWidth, 1)))
  const scoreTextWidth = p.width(model.cover.scoreText, scoreSize)
  p.text(model.cover.scoreText, contentLeft, scoreTop + 16 + (39 - scoreSize) / 2, scoreSize, model.cover.score == null ? '#C9CDD3' : '#F26368')
  p.text(totalLabel, contentLeft + scoreTextWidth + 5, scoreTop + 38, 14, '#C9CDD3')
  model.cover.insightPills.slice(0, 2).forEach((item, index) => {
    const top = coverTop + 103 + index * 25
    p.roundRect(contentLeft, top, scoreWidth, 19, 10, index ? '#F7F0F1' : '#FFF2EF')
    p.text(p.fit(item.text, scoreWidth - 12, 8), contentLeft + 6, top + 5, 8, index ? '#B76A72' : '#D9786F')
  })
  if (hasRadar) {
    const radarLeft = contentLeft + scoreWidth + 4
    const radarWidth = contentWidth - scoreWidth - 4
    drawRadar(ctx, p, model.radar, radarLeft + radarWidth / 2, coverTop + 8 + 75, Math.min(radarWidth * 0.24, 45), { left: radarLeft, right: radarLeft + radarWidth })
  }
  const metaTop = coverTop + coverHeight - 38
  p.roundRect(contentLeft, metaTop, contentWidth, 24, 12, '#F0F1F2')
  p.text(p.fit(`${model.context} · ${model.period}`, contentWidth - 20, 9), left + innerWidth / 2, metaTop + 8, 9, '#858B94', 'center')
  const adviceTop = coverTop + coverHeight + 10
  p.text('本轮小建议', left + 18, adviceTop, 11, '#FFFFFF')
  p.text(p.fit(model.advice, innerWidth - 110, 11), left + 91, adviceTop, 11, '#FFFFFF')
  y = coverTop + coverHeight + 58

  // 掌握情况
  const masteryHeading = y
  const masteryTitle = section('掌握情况', masteryHeading, 'mastery')
  y += 43
  p.roundRect(left, y, innerWidth, 74, 20, '#FFFFFF')
  masteryTitle()
  const cellWidth = innerWidth / model.summary.length
  model.summary.forEach((item, index) => {
    const center = left + cellWidth * (index + 0.5)
    p.text(item.value, center, y + 14, 20, item.color, 'center')
    p.text(item.label, center, y + 43, 10, item.color, 'center')
    if (index < model.summary.length - 1) {
      ctx.beginPath()
      ctx.moveTo(left + cellWidth * (index + 1), y + 17)
      ctx.lineTo(left + cellWidth * (index + 1), y + 58)
      ctx.setStrokeStyle('#D9DDE2')
      ctx.setLineWidth(1)
      ctx.stroke()
    }
  })
  y += 100

  // 知识薄弱点 + 待补齐证据
  const weakPoints = model.weakPoints
  if (weakPoints.length || model.pendingCount) {
    const weakHeading = y
    const weakTitle = section('知识薄弱点', weakHeading, 'weak')
    y += 43
    const textWidth = innerWidth - 32
    const rows = weakPoints.map((item) => {
      const reason = p.lines(item.reason, textWidth, 10, 3)
      return { item, reason, height: 36 + reason.length * 15 }
    })
    const moreHeight = model.weakMore ? 22 : 0
    const tagWidth = (innerWidth - 58) / 2
    const tagRows = Math.ceil(model.pendingPoints.length / 2)
    const pendingMore = model.pendingCount > model.pendingPoints.length
    const pendingHeight = model.pendingCount ? 64 + tagRows * 27 + (pendingMore ? 18 : 0) : 0
    const cardHeight = 14 + rows.reduce((sum, row) => sum + row.height, 0) + moreHeight + (pendingHeight ? pendingHeight + 12 : 0) + 6
    const cardTop = y
    p.roundRect(left, cardTop, innerWidth, cardHeight, 20, '#FFFFFF')
    weakTitle()
    y += 14
    rows.forEach((row, index) => {
      const categoryWidth = p.width(row.item.category, 9)
      p.text(p.fit(row.item.title, textWidth - categoryWidth - 10, 12), left + 16, y + 4, 12, INK)
      p.text(row.item.category, right - 16, y + 6, 9, '#A3ABA4', 'right')
      row.reason.forEach((line, lineIndex) => p.text(line, left + 16, y + 26 + lineIndex * 15, 10, '#808B82'))
      y += row.height
      if (index < rows.length - 1 || moreHeight) {
        ctx.beginPath()
        ctx.moveTo(left + 16, y - 4)
        ctx.lineTo(right - 16, y - 4)
        ctx.setStrokeStyle('#F0F1F2')
        ctx.setLineWidth(1)
        ctx.stroke()
      }
    })
    if (moreHeight) {
      p.text(`另有 ${model.weakMore} 个知识点待提升`, left + 16, y + 2, 10, '#A3ABA4')
      y += moreHeight
    }
    if (pendingHeight) {
      const boxTop = rows.length ? y + 4 : y
      p.roundRect(left + 14, boxTop, innerWidth - 28, pendingHeight, 13, '#F7F8F6')
      ctx.beginPath()
      ctx.arc(left + 28, boxTop + 20, 4, 0, Math.PI * 2)
      ctx.setStrokeStyle('#ACB4AD')
      ctx.setLineWidth(1.5)
      ctx.stroke()
      p.text(`待补齐证据 · ${model.pendingCount} 个知识点`, left + 40, boxTop + 13, 11, '#56635A')
      p.text(p.fit('以下知识点尚未完成测评，不按薄弱或未掌握处理。', innerWidth - 50, 9), left + 25, boxTop + 36, 9, '#8A958C')
      model.pendingPoints.forEach((name, index) => {
        const tagX = left + 25 + (index % 2) * ((innerWidth - 48) / 2)
        const tagTop = boxTop + 56 + Math.floor(index / 2) * 27
        p.roundRect(tagX, tagTop, tagWidth, 21, 10, '#FFFFFF')
        p.text(p.fit(name, tagWidth - 16, 9), tagX + 8, tagTop + 6, 9, '#7E8980')
      })
      if (pendingMore) p.text(`等 ${model.pendingCount} 个知识点`, left + 25, boxTop + 56 + tagRows * 27 + 2, 9, '#A3ABA4')
    }
    y = cardTop + cardHeight + 26
  }

  // 提升路径
  if (model.pathStages.length) {
    const pathHeading = y
    const pathTitle = section('提升路径', pathHeading, 'path')
    y += 43
    const textWidth = innerWidth - 70
    const stages = model.pathStages.map((stage) => {
      const focus = p.lines(stage.focus, textWidth, 10, 2)
      const detail = p.lines(stage.detail, textWidth, 9, 3)
      return { stage, focus, detail, height: 30 + focus.length * 15 + detail.length * 14 + 14 }
    })
    const cardHeight = 54 + stages.reduce((sum, row) => sum + row.height, 0)
    p.roundRect(left, y, innerWidth, cardHeight, 20, '#FFFFFF')
    pathTitle()
    p.roundRect(left + 14, y + 13, innerWidth - 28, 28, 14, '#FFF4E9')
    p.text(p.fit(`待提升 · ${model.pathEstimate}`, innerWidth - 52, 10), left + 26, y + 22, 10, '#D9731C')
    let stageTop = y + 54
    stages.forEach((row) => {
      p.gradientShape(left + 20, stageTop - 3, 24, 24, [12, 12, 12, 12], '#FF9392', '#EA5965')
      p.text(row.stage.number, left + 32, stageTop + 4, 9, '#FFFFFF', 'center')
      p.text(row.stage.phase, left + 54, stageTop, 12, INK)
      p.text(row.stage.duration, right - 15, stageTop + 2, 9, '#D37E35', 'right')
      row.focus.forEach((line, index) => p.text(line, left + 54, stageTop + 20 + index * 15, 10, '#536057'))
      const detailTop = stageTop + 22 + row.focus.length * 15
      row.detail.forEach((line, index) => p.text(line, left + 54, detailTop + index * 14, 9, '#8A958C'))
      stageTop += row.height
    })
    y += cardHeight + 10
  }

  }

  // 各轮逐题证据随分享图片一起导出，不能只导出汇总掌握度。
  if ((model.questionTimings || []).length) {
    y += 24
    p.text(model.timingPageLabel || '逐题用时 · 已完成轮次', left + 12, y, 15, INK)
    y += 34
    model.questionTimings.forEach((q) => {
      const lines = p.lines(q.prompt, innerWidth - 32, 10, 2)
      const prior = q.previousTimingLabel ? p.lines(q.previousTimingLabel, innerWidth - 32, 9, 2) : []
      const h = 53 + lines.length * 15 + prior.length * 14
      p.roundRect(left, y, innerWidth, h, 12, '#FFFFFF')
      p.text(`第${q.round || 1}轮 · 第${q.number}题 · ${q.resultLabel}`, left + 16, y + 13, 10, INK)
      p.text(q.timingLabel, right - 16, y + 13, 11, '#2B7263', 'right')
      lines.forEach((line, i) => p.text(line, left + 16, y + 35 + i * 15, 10, '#737E77'))
      prior.forEach((line, i) => p.text(line, left + 16, y + 37 + lines.length * 15 + i * 14, 9, '#737E77'))
      y += h + 8
    })
    const note = p.lines(model.timingNotice, innerWidth - 24, 9, 8)
    note.forEach((line, i) => p.text(line, left + 12, y + 10 + i * 14, 9, '#737E77'))
    y += 24 + note.length * 14
  }
  return Math.ceil(y + topInset + 24)
}

// 保持原清晰度，按实测绘制高度拆页，避免长卷超过设备画布边长。
function reportSharePages(model, measure, maxHeight) {
  const rows = model.questionTimings || []
  const pages = []
  let cursor = 0
  do {
    let count = Math.min(20, rows.length - cursor)
    let part
    do {
      part = { ...model, timingOnly: pages.length > 0, questionTimings: rows.slice(cursor, cursor + count) }
      if (measure(part) <= maxHeight || count <= 1) break
      count--
    } while (true)
    pages.push(part)
    cursor += count
  } while (cursor < rows.length)
  return pages.map((part, index) => ({ ...part, timingPageLabel: pages.length > 1 ? `逐题用时 · 第${index + 1}/${pages.length}张` : '' }))
}
module.exports = { drawReportShare, reportSharePages }
