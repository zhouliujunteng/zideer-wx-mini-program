const { fullDayLabel, durationText, minuteOptionLabel } = require('../../utils/study-plan-view')

// 老师「学习安排」导出的排课图片（2026-10-06，更新日志 1.0.3「排课完成后，可以导出为图片并发送到学习群」）。
// 竖版长图：蓝色头部写学生名、每天学习时长、日期范围；下面一天一张白卡，列课程名 / 第几页 / 预计时长。
// 按 375 宽排版；一天任务太多写「等 N 项」，天数太多画不下时后面的天截掉、写「等 N 天」。
// 画布单边不超过 4000 像素（与测评报告长图同一上限）：内容短时按 3 倍导出，长了降到 2 倍。
// 图会在群里留很久，日期一律写「10月8日 周四」，不写今天 / 明天；图里不放二维码，品牌只写文字「知鹿学习」。
// 只排版、画图，不碰画布节点与导出：那些在页面里（teacher/study-plan/index.js 的 renderPlanImage）。

const POSTER_WIDTH = 375
const MAX_SCALE = 3
const MIN_SCALE = 2
const MAX_PIXELS = 4000
const MAX_HEIGHT = MAX_PIXELS / MIN_SCALE
const FONT = '"PingFang SC", "Helvetica Neue", sans-serif'
const BRAND = '知鹿学习'
const FOOTER_NOTE = '学生在小程序「学习 › 学习任务」里按日期查看'

const SIDE = 16
const CARD_WIDTH = POSTER_WIDTH - SIDE * 2
const INSET = 16
const TASK_INDENT = 14
const HEADER_HEIGHT = 176
// 浅灰面板的圆角压在蓝色头部上，和页面一样
const PANEL_TOP = 158
const CONTENT_TOP = PANEL_TOP + 16
// 卡片顶到第一条任务的分隔线
const DAY_HEADING = 46
const TASK_HEIGHT = 48
const MORE_HEIGHT = 30
const CARD_BOTTOM = 6
const CARD_GAP = 12
const MORE_DAYS_HEIGHT = 30
const FOOTER_HEIGHT = 84
const MAX_TASKS_PER_DAY = 5

const TONE_COLORS = { todo: '#FD7C02', overdue: '#F7B9A6', done: '#BFE3CB' }

// 按宽度截断：放得下原样返回，放不下截到能放下为止并补「…」（截掉末尾的空格和分隔符再补）。
function fitText(ctx, text, maxWidth) {
  const value = String(text || '')
  if (!value || ctx.measureText(value).width <= maxWidth) return value
  const chars = Array.from(value)
  let low = 0
  let high = chars.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (ctx.measureText(`${chars.slice(0, mid).join('')}…`).width <= maxWidth) low = mid
    else high = mid - 1
  }
  return `${chars.slice(0, low).join('').replace(/[\s·、，,]+$/, '')}…`
}

// 图里只写绝对日期：「10月8日 周四」（fullDayLabel 不给今天时就是这个写法）
function dateText(day) {
  return fullDayLabel(day, '')
}

function taskMeta(task) {
  const minutes = Math.round(Number(task.minutes) || 0)
  return [
    task.pageLabel || '',
    minutes > 0 ? `约 ${minutes} 分钟` : '',
    task.state === 'done' ? '已学完' : (task.overdue ? '补学' : '')
  ].filter(Boolean).join(' · ')
}

function dayMinutes(day) {
  const minutes = Number(day.minutes)
  return minutes > 0 ? minutes : day.tasks.reduce((sum, task) => sum + (Number(task.minutes) || 0), 0)
}

// plan 是课程服务返回的原样安排：{ dailyMinutes, days: [{ day, minutes, tasks: [{ title, pageLabel, minutes, overdue, state }] }] }。
// 没有任务时返回 null。版面位置都在这里算好，画的时候照着画。
function buildPlanPoster({ studentName = '', plan = null } = {}) {
  const days = ((plan && plan.days) || []).filter((day) => day && Array.isArray(day.tasks) && day.tasks.length)
  if (!days.length) return null
  const taskCount = days.reduce((sum, day) => sum + day.tasks.length, 0)
  const cards = []
  let y = CONTENT_TOP
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index]
    const shown = day.tasks.slice(0, MAX_TASKS_PER_DAY)
    const more = day.tasks.length > shown.length
    const height = DAY_HEADING + shown.length * TASK_HEIGHT + (more ? MORE_HEIGHT : 0) + CARD_BOTTOM
    // 后面还有天时，给「等 N 天」那一行留出位置；第一天总要画
    const reserve = FOOTER_HEIGHT + (index === days.length - 1 ? 0 : MORE_DAYS_HEIGHT)
    if (cards.length && y + height + reserve > MAX_HEIGHT) break
    const minutes = dayMinutes(day)
    cards.push({
      y,
      height,
      title: dateText(day.day),
      minutesText: minutes > 0 ? `共 ${durationText(minutes)}` : '',
      tasks: shown.map((task) => ({
        title: task.title || '定制课程',
        meta: taskMeta(task),
        tone: task.state === 'done' ? 'done' : (task.overdue ? 'overdue' : 'todo')
      })),
      moreText: more ? `…等 ${day.tasks.length} 项` : ''
    })
    y += height + CARD_GAP
  }
  let bottom = y - CARD_GAP
  const moreDaysText = cards.length < days.length ? `…等 ${days.length} 天` : ''
  const moreDaysY = bottom + 22
  if (moreDaysText) bottom += MORE_DAYS_HEIGHT
  const height = Math.ceil(bottom + FOOTER_HEIGHT)
  const first = days[0].day
  const last = days[days.length - 1].day
  const dailyMinutes = Number(plan.dailyMinutes) || 0
  return {
    width: POSTER_WIDTH,
    height,
    // 画得下就 3 倍，长图降倍数保证单边不超过 MAX_PIXELS（MAX_HEIGHT 已按 2 倍算好，不会低于 2 倍）
    scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.floor(MAX_PIXELS / height * 100) / 100)),
    title: studentName ? `${studentName}的学习安排` : '每日学习安排',
    summary: [dailyMinutes ? `每天 ${minuteOptionLabel(dailyMinutes)}` : '', `共 ${days.length} 天`, `${taskCount} 项学习任务`].filter(Boolean).join(' · '),
    range: first === last ? dateText(first) : `${dateText(first)} 至 ${dateText(last)}`,
    cards,
    moreDaysText,
    moreDaysY,
    footerTop: bottom
  }
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

// 画一行字，给了 maxWidth 就按宽度截断；返回实际画出的文字
function drawText(ctx, value, x, y, { size, weight = 400, color, align = 'left', maxWidth = 0 }) {
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.fillStyle = color
  ctx.textAlign = align
  const line = maxWidth ? fitText(ctx, value, maxWidth) : String(value || '')
  if (line) ctx.fillText(line, x, y)
  return line
}

function drawCard(ctx, card) {
  const left = SIDE + INSET
  const right = SIDE + CARD_WIDTH - INSET
  const textLeft = left + TASK_INDENT
  fillRound(ctx, SIDE, card.y, CARD_WIDTH, card.height, 14, '#FFFFFF')
  // 日期在左、当天时长在右：先画右边，日期按剩下的宽度截断
  const minutes = drawText(ctx, card.minutesText, right, card.y + 30, { size: 12, color: '#7E8A82', align: 'right' })
  const minutesWidth = minutes ? ctx.measureText(minutes).width + 12 : 0
  drawText(ctx, card.title, left, card.y + 30, { size: 15, weight: 700, color: '#24332D', maxWidth: right - left - minutesWidth })
  card.tasks.forEach((task, index) => {
    const top = card.y + DAY_HEADING + index * TASK_HEIGHT
    ctx.fillStyle = '#F0F3F1'
    ctx.fillRect(left, top, right - left, 0.75)
    fillRound(ctx, left, top + 10, 4, 28, 2, TONE_COLORS[task.tone] || TONE_COLORS.todo)
    drawText(ctx, task.title, textLeft, top + 22, { size: 14, weight: 600, color: '#27332C', maxWidth: right - textLeft })
    drawText(ctx, task.meta, textLeft, top + 40, { size: 12, color: '#929B95', maxWidth: right - textLeft })
  })
  if (card.moreText) {
    const top = card.y + DAY_HEADING + card.tasks.length * TASK_HEIGHT
    ctx.fillStyle = '#F0F3F1'
    ctx.fillRect(left, top, right - left, 0.75)
    drawText(ctx, card.moreText, textLeft, top + 20, { size: 12, color: '#A0A9A3', maxWidth: right - textLeft })
  }
}

// ctx 已按 poster.scale 缩放好，这里只按 375 宽的版面画
function drawPlanPoster(ctx, poster) {
  const { width, height } = poster
  const center = width / 2
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#FAFAFA'
  ctx.fillRect(0, 0, width, height)
  const gradient = ctx.createLinearGradient(0, 0, 0, HEADER_HEIGHT)
  gradient.addColorStop(0, '#1E87FD')
  gradient.addColorStop(1, '#4BA5FF')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, HEADER_HEIGHT)
  // 下面两个圆角落在画布外，只留上面两个
  fillRound(ctx, 0, PANEL_TOP, width, height - PANEL_TOP + 24, 18, '#FAFAFA')

  drawText(ctx, BRAND, 20, 40, { size: 15, weight: 700, color: '#FFFFFF' })
  drawText(ctx, poster.title, 20, 90, { size: 24, weight: 700, color: '#FFFFFF', maxWidth: width - 40 })
  drawText(ctx, poster.summary, 20, 118, { size: 13, color: 'rgba(255, 255, 255, 0.92)', maxWidth: width - 40 })
  drawText(ctx, poster.range, 20, 140, { size: 12, color: 'rgba(255, 255, 255, 0.78)', maxWidth: width - 40 })

  poster.cards.forEach((card) => drawCard(ctx, card))

  if (poster.moreDaysText) drawText(ctx, poster.moreDaysText, center, poster.moreDaysY, { size: 12, color: '#7E8A82', align: 'center', maxWidth: width - 40 })
  drawText(ctx, FOOTER_NOTE, center, poster.footerTop + 32, { size: 12, color: '#939C96', align: 'center', maxWidth: width - 40 })
  drawText(ctx, BRAND, center, poster.footerTop + 58, { size: 15, weight: 700, color: '#FD7C02', align: 'center' })
  ctx.restore()
}

module.exports = {
  POSTER_WIDTH,
  MAX_PIXELS,
  MAX_TASKS_PER_DAY,
  fitText,
  buildPlanPoster,
  drawPlanPoster
}
