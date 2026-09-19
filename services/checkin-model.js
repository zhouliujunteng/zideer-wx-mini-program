// 每日学习打卡页（设计仓库 E05，提交 b5cc5ab）的页面模型。
// 输入是后端「读取当前学生学习打卡」动作流返回的今天日期与打卡日期（北京时间，YYYY-MM-DD）：
// 当天有效课程学习累计满 5 分钟即算一天打卡（2026-09-19 用户决定）。本模块只做计算，不读写任何状态。
//
// 统计口径：
// - 连续天数：今天已打卡则从今天往前数，今天未打卡则从昨天往前数（今天还有机会，不算断签）。
// - 打卡天数：所看月份内的打卡天数。
// - 连胜周数：一周为周日至周六；从所看月份最后一周（当月为本周）往前数连续「至少打卡一次」的周数，
//   当月本周尚无打卡时从上周起算。
// - 累计天数：全部打卡天数（海报「已累计学习打卡 X 天」）。

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const WEEKDAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

// 火花区背景方块：行数、每行数量与透明度序列按设计规格固定。
const CORNER_ROWS = [
  [20, 0.3], [19, 0.29], [18, 0.28], [17, 0.26], [19, 0.25], [17, 0.23], [16, 0.21], [18, 0.2], [16, 0.18],
  [15, 0.17], [13, 0.15], [14, 0.14], [12, 0.12], [13, 0.12], [11, 0.11], [10, 0.11], [11, 0.1], [10, 0.09]
]
const CORNER_VARIATIONS = [0.16, -0.08, 0.07, -0.12, 0.02, -0.04, 0.12, -0.1, 0.05, -0.14, 0.1]
const CORNER_SQUARES = []
CORNER_ROWS.forEach(([count, base], row) => {
  for (let column = 0; column < count; column += 1) {
    const opacity = Math.max(0.03, base + CORNER_VARIATIONS[(row + column) % CORNER_VARIATIONS.length] - row * 0.007 - column * 0.008)
    CORNER_SQUARES.push({
      id: `corner-${row + 1}-${column + 1}`,
      x: column * 40,
      bottom: (CORNER_ROWS.length - row - 1) * 40 + 10,
      opacity: Number(opacity.toFixed(3)),
      activeOpacity: Number(Math.min(0.62, opacity + 0.14).toFixed(3))
    })
  }
})

const SHARE_ACTIONS = [
  { id: 'save', label: '保存', iconSrc: '/learning/assets/check-in/share-download.svg' },
  { id: 'friend', label: '分享好友', iconSrc: '/learning/assets/check-in/share-wechat.svg' },
  { id: 'timeline', label: '朋友圈', iconSrc: '/learning/assets/check-in/share-moments.svg' }
]

// 成功弹层里的装饰性方块图案（设计稿占位，不是可扫描的二维码）。
const QR_PATTERN = [
  1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0, 1,
  1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1
]

// 日期一律按 UTC 零点的「日历日」处理，避免设备时区影响日期加减。
function parseDay(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

function dayKey(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000)
}

function weekStart(date) {
  return addDays(date, -date.getUTCDay())
}

function countStreakDays(checked, today) {
  let cursor = checked.has(dayKey(today)) ? today : addDays(today, -1)
  let days = 0
  while (checked.has(dayKey(cursor))) {
    days += 1
    cursor = addDays(cursor, -1)
  }
  return days
}

function weekHasCheckIn(checked, start) {
  for (let offset = 0; offset < 7; offset += 1) {
    if (checked.has(dayKey(addDays(start, offset)))) return true
  }
  return false
}

function countStreakWeeks(checked, today, viewedYear, viewedMonth) {
  const isCurrentMonth = viewedYear === today.getUTCFullYear() && viewedMonth === today.getUTCMonth() + 1
  const lastDay = isCurrentMonth ? today : new Date(Date.UTC(viewedYear, viewedMonth, 0))
  let start = weekStart(lastDay)
  if (isCurrentMonth && !weekHasCheckIn(checked, start)) start = addDays(start, -7)
  let weeks = 0
  while (weekHasCheckIn(checked, start)) {
    weeks += 1
    start = addDays(start, -7)
  }
  return weeks
}

function buildCalendar(checked, today, viewedYear, viewedMonth) {
  const first = new Date(Date.UTC(viewedYear, viewedMonth - 1, 1))
  const daysInMonth = new Date(Date.UTC(viewedYear, viewedMonth, 0)).getUTCDate()
  const leading = first.getUTCDay()
  const cellCount = Math.ceil((leading + daysInMonth) / 7) * 7
  const todayKey = dayKey(today)
  const days = Array.from({ length: cellCount }, (_, index) => {
    const date = addDays(first, index - leading)
    const key = dayKey(date)
    return {
      id: key,
      date: date.getUTCDate(),
      isInMonth: date.getUTCMonth() === viewedMonth - 1,
      isToday: key === todayKey,
      isChecked: checked.has(key),
      isFuture: key > todayKey,
      isRunStart: false,
      isRunMiddle: false,
      isRunEnd: false
    }
  })
  // 连续打卡连成色带；色带在周边界和月份边界处断开，与设计稿一致。
  days.forEach((day, index) => {
    if (!day.isChecked) return
    const prev = days[index - 1]
    const next = days[index + 1]
    day.isRunStart = index % 7 === 0 || !prev.isChecked || !prev.isInMonth
    day.isRunEnd = index % 7 === 6 || !next.isChecked || !next.isInMonth
    day.isRunMiddle = !day.isRunStart && !day.isRunEnd
  })
  const rowCount = cellCount / 7
  return {
    monthLabel: `${viewedYear}年${viewedMonth}月`,
    viewedYear,
    viewedMonth,
    canGoNext: first < new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    weekdayLabels: WEEKDAYS,
    rowCount,
    height: 82 + rowCount * 94,
    days
  }
}

function buildCheckInModel({ today: todayKey, checkedDates = [], viewedYear, viewedMonth, nickname = '' } = {}) {
  const today = parseDay(todayKey)
  if (!today) throw new Error('打卡日期无效')
  const checked = new Set(checkedDates.filter((key) => parseDay(key) && key <= todayKey))
  const year = viewedYear || today.getUTCFullYear()
  const month = viewedMonth || today.getUTCMonth() + 1
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`
  const checkedToday = checked.has(todayKey)
  const streakDays = countStreakDays(checked, today)
  const totalDays = checked.size

  return {
    header: { title: '学习连胜' },
    hero: {
      label: '已连续学习',
      stateLabel: checkedToday ? '今天也保持住了' : '今天还没打卡',
      tone: checkedToday ? 'active' : 'idle',
      animationSrc: checkedToday ? '/learning/assets/check-in/streak.svg' : '/learning/assets/check-in/streak-gray.svg',
      cornerSquares: CORNER_SQUARES
    },
    streak: {
      days: streakDays,
      totalDays: [...checked].filter((key) => key.startsWith(monthPrefix)).length,
      streakWeeks: countStreakWeeks(checked, today, year, month)
    },
    calendar: buildCalendar(checked, today, year, month),
    checkedToday,
    action: checkedToday
      ? { state: 'checked-in', label: '分享一下' }
      : { state: 'not-checked-in', label: '立刻学习' },
    successSheet: {
      title: '打卡成功',
      subtitle: '今天的学习火花已点亮',
      posterTitle: '我已在知鹿连续学习',
      posterSubtitle: '每天一点点，学习有连胜',
      streakDays,
      totalDays,
      shareCopy: `我已在知鹿连续学习 ${streakDays} 天`,
      posterDate: `${today.getUTCMonth() + 1}月${today.getUTCDate()}日`,
      posterDateLine: todayKey,
      posterWeekday: WEEKDAY_NAMES[today.getUTCDay()],
      qrPattern: QR_PATTERN
    },
    shareCard: { posterNickname: String(nickname || '').trim() || '知鹿学习者' },
    shareActions: SHARE_ACTIONS
  }
}

module.exports = { buildCheckInModel, countStreakDays, countStreakWeeks, parseDay }
