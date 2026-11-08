// 每日学习打卡页（设计仓库 E05，提交 b5cc5ab）的页面模型。
// 输入是后端「读取当前学生学习打卡」动作流的结果（日期一律北京时间 YYYY-MM-DD）。本模块只做计算，不读写任何状态。
//
// 打卡规则（2026-09-25 用户决定）：当天学完一节课，或一节课的费曼验收 AI 判定通过，算一天；
// 2026-10-08 起完成一次间隔复习（学习任务里的「复习」）也算。
// 道具卡：冻结卡冻结几天，这几天不打卡也不断连胜；复活卡把最近断掉的几天补上。受保护的日子接得上连胜，但不计入天数。
// 连胜算法与 Zion 端 scripts/learning-streak/zion/streak-core.js 一致，两边用同一组测试数据。
//
// 统计口径：
// - 连续天数：今天已打卡（或今天受保护）则从今天往前数，否则从昨天往前数（今天还有机会，不算断签）；
//   连续的「打卡或受保护」日子里，只数真正打卡的天数。
// - 打卡天数：所看月份内的打卡天数。
// - 连胜周数：一周为周日至周六；从所看月份最后一周（当月为本周）往前数连续「有打卡或受保护日」的周数，
//   当月本周还没有时从上周起算。
// - 累计天数：全部打卡天数（海报「已累计学习打卡 X 天」）。
// - 连胜金币：打卡送的金币累计（后端 coinsEarned）。
// - 打卡金币按连续天数递增（2026-09-27；上线时保底 20、每连续一天 +10、封顶 100，管理端可调），
//   由后端算好下一次打卡能拿多少（reward.nextCoins），页面不自己算。

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

// kept = 打卡日 ∪ 受保护日（冻结、复活）；不传时只按打卡日算（旧版调用方）。
function countStreakDays(checked, today, kept = checked) {
  let cursor = kept.has(dayKey(today)) ? today : addDays(today, -1)
  let days = 0
  for (let guard = 0; guard < 5000 && kept.has(dayKey(cursor)); guard += 1) {
    if (checked.has(dayKey(cursor))) days += 1
    cursor = addDays(cursor, -1)
  }
  return days
}

function weekHasCheckIn(kept, start) {
  for (let offset = 0; offset < 7; offset += 1) {
    if (kept.has(dayKey(addDays(start, offset)))) return true
  }
  return false
}

function countStreakWeeks(kept, today, viewedYear, viewedMonth) {
  const isCurrentMonth = viewedYear === today.getUTCFullYear() && viewedMonth === today.getUTCMonth() + 1
  const lastDay = isCurrentMonth ? today : new Date(Date.UTC(viewedYear, viewedMonth, 0))
  let start = weekStart(lastDay)
  if (isCurrentMonth && !weekHasCheckIn(kept, start)) start = addDays(start, -7)
  let weeks = 0
  while (weekHasCheckIn(kept, start)) {
    weeks += 1
    start = addDays(start, -7)
  }
  return weeks
}

// 后端给的日期整理成集合：打卡日只收今天及以前；冻结日可以在未来（已经冻好的日子）。
function daySets({ today: todayKey, checkedDates = [], frozenDates = [], revivedDates = [] }) {
  const valid = (list) => (Array.isArray(list) ? list : []).filter((key) => parseDay(key))
  const checked = new Set(valid(checkedDates).filter((key) => key <= todayKey))
  const frozen = new Set(valid(frozenDates))
  const revived = new Set(valid(revivedDates).filter((key) => key <= todayKey))
  const kept = new Set(checked)
  frozen.forEach((key) => { if (key <= todayKey) kept.add(key) })
  revived.forEach((key) => kept.add(key))
  return { checked, frozen, revived, kept }
}

// 学习页「连续学习」、顶栏火苗等只要天数的地方用。
function streakDaysOf(checkin) {
  const today = parseDay(checkin && checkin.today)
  if (!today) return 0
  const sets = daySets(checkin)
  return countStreakDays(sets.checked, today, sets.kept)
}

function buildCalendar(sets, today, viewedYear, viewedMonth) {
  const first = new Date(Date.UTC(viewedYear, viewedMonth - 1, 1))
  const daysInMonth = new Date(Date.UTC(viewedYear, viewedMonth, 0)).getUTCDate()
  const leading = first.getUTCDay()
  const cellCount = Math.ceil((leading + daysInMonth) / 7) * 7
  const todayKey = dayKey(today)
  const days = Array.from({ length: cellCount }, (_, index) => {
    const date = addDays(first, index - leading)
    const key = dayKey(date)
    const isChecked = sets.checked.has(key)
    // 同一天既打了卡又受保护时按打卡显示；受保护日：冻结（冰蓝，可以在未来）、复活（玫红）。
    const isFrozen = !isChecked && sets.frozen.has(key)
    const isRevived = !isChecked && !isFrozen && sets.revived.has(key)
    return {
      id: key,
      date: date.getUTCDate(),
      isInMonth: date.getUTCMonth() === viewedMonth - 1,
      isToday: key === todayKey,
      isChecked,
      isFrozen,
      isRevived,
      isMarked: isChecked || isFrozen || isRevived,
      // 每天一个实心圆，连着的几天也不连成色带（2026-09-26 用户要求）
      isFuture: key > todayKey
    }
  })
  const rowCount = cellCount / 7
  const monthPrefix = `${viewedYear}-${String(viewedMonth).padStart(2, '0')}-`
  const inMonth = (set) => [...set].filter((key) => key.startsWith(monthPrefix)).length
  return {
    monthLabel: `${viewedYear}年${viewedMonth}月`,
    viewedYear,
    viewedMonth,
    canGoNext: first < new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    weekdayLabels: WEEKDAYS,
    rowCount,
    height: 82 + rowCount * 94,
    // 日历下方的图例：这个月用过哪种卡才显示哪一项。
    legend: {
      frozen: [...sets.frozen].filter((key) => key.startsWith(monthPrefix) && !sets.checked.has(key)).length > 0,
      revived: inMonth(sets.revived) > 0
    },
    days
  }
}

const CARD_TITLES = { freeze: '冻结卡', revive: '复活卡' }

// 「9月26日」「9月26日–28日」「9月30日–10月2日」
function shortDate(key) {
  return `${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日`
}

function dateRange(dates) {
  const list = (dates || []).filter((key) => parseDay(key)).sort()
  if (!list.length) return ''
  const first = list[0]
  const last = list[list.length - 1]
  if (first === last) return shortDate(first)
  const tail = first.slice(0, 7) === last.slice(0, 7) ? `${Number(last.slice(8, 10))}日` : shortDate(last)
  return `${shortDate(first)}–${tail}`
}

function wholeNumber(value) {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}

// 今日打卡任务：一行，「学完一节课、通过费曼验收或完成一次复习」。
// 没打卡时右边是「去学习 ›」，打过卡（含旧规则点亮的那天）右边只画一个对勾。
// 打卡送金币开着时，前面再放一个金币提示：没打卡是今天打卡能拿多少（「+40 金币」），打过卡是明天（「明天 +50 金币」）。
function buildTodayTask({ todayCheckin, checkedToday, frozenToday, reward }) {
  const next = reward && reward.enabled ? wholeNumber(reward.nextCoins) : 0
  // 后端说的是今天还是明天，要和页面自己算的「今天打没打卡」一致才提示，免得把明天的数说成今天的
  const sameDay = Boolean(reward) && (reward.nextDay === 'tomorrow') === checkedToday
  return {
    label: '学完一节课、通过验收或完成一次复习',
    complete: checkedToday,
    frozen: !checkedToday && frozenToday,
    earned: todayCheckin ? wholeNumber(todayCheckin.rewardCoins) : 0,
    coinHint: next && sameDay ? (checkedToday ? `明天 +${next} 金币` : `+${next} 金币`) : '',
    action: checkedToday ? '' : '去学习 ›'
  }
}

// 发放规则说成人话：「每连续打卡 7 天送 1 张」「第一次打卡送 1 张」。
function ruleLabel(rule) {
  const count = `送 ${rule.count} 张`
  if (rule.trigger === 'total_days') {
    if (rule.repeat === 'every') return `每累计打卡 ${rule.days} 天${count}`
    return rule.days === 1 ? `第一次打卡${count}` : `累计打卡满 ${rule.days} 天${count}`
  }
  return rule.repeat === 'every' ? `每连续打卡 ${rule.days} 天${count}` : `连续打卡满 ${rule.days} 天${count}`
}

// 道具卡：余额（有卡点亮、没卡灰色）、说明、能不能用、用了会怎样、怎么获得（只列发放规则，本页不做激活码入口）。
function buildCards({ cards, cardRules, freezePlan, revivable, sets, todayKey, streakDays }) {
  const byType = {}
  ;(Array.isArray(cards) ? cards : []).forEach((card) => { if (card && CARD_TITLES[card.type]) byType[card.type] = card })
  const frozenAhead = [...sets.frozen].filter((key) => key >= todayKey && !sets.checked.has(key)).sort()
  return ['freeze', 'revive'].map((type) => {
    const card = byType[type] || {}
    const count = wholeNumber(card.count)
    const effectDays = wholeNumber(card.effectDays) || 3
    const windowDays = wholeNumber(card.windowDays) || 7
    const enabled = card.enabled !== false && Boolean(byType[type])
    const title = String(card.title || '').trim() || CARD_TITLES[type]
    const description = String(card.description || '').trim() || (type === 'freeze'
      ? `冻结 ${effectDays} 天，这几天不打卡也不会断连胜`
      : `连胜断了 ${windowDays} 天内可用，补回最多 ${effectDays} 天`)
    let plan = null
    let reason = ''
    if (type === 'freeze') {
      const dates = Array.isArray(freezePlan) ? freezePlan.filter((key) => parseDay(key)) : []
      if (dates.length) plan = { dates, label: `冻结 ${dateRange(dates)}，共 ${dates.length} 天` }
      else if (!streakDays) reason = '有连胜时才能用'
    } else {
      const dates = revivable && Array.isArray(revivable.dates) ? revivable.dates.filter((key) => parseDay(key)) : []
      if (dates.length) plan = { dates, label: `补回 ${dateRange(dates)}，共 ${dates.length} 天` }
      else reason = '连胜没有断，暂时用不上'
    }
    if (!enabled) reason = '暂未开放'
    else if (!count) reason = `还没有${title}`
    const usable = enabled && count > 0 && Boolean(plan)
    return {
      type,
      title,
      count,
      description,
      usable,
      // 有卡就点亮，没卡是灰的（学习连胜页的卡牌标志）
      lit: count > 0,
      reason: usable ? plan.label : reason,
      plan,
      statusLabel: type === 'freeze' && frozenAhead.length ? `冻结中 · ${dateRange(frozenAhead)}` : '',
      howToGet: (Array.isArray(cardRules) ? cardRules : []).filter((rule) => rule.cardType === type).map(ruleLabel),
      iconSrc: `/learning/assets/check-in/card-${type}.svg`
    }
  })
}

function buildCheckInModel({
  today: todayKey, checkedDates = [], frozenDates = [], revivedDates = [], todayCheckin = null, reward = null,
  coinsEarned = 0, cards = [], cardRules = [], freezePlan = null, revivable = null, viewedYear, viewedMonth, nickname = ''
} = {}) {
  const today = parseDay(todayKey)
  if (!today) throw new Error('打卡日期无效')
  const sets = daySets({ today: todayKey, checkedDates, frozenDates, revivedDates })
  const year = viewedYear || today.getUTCFullYear()
  const month = viewedMonth || today.getUTCMonth() + 1
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`
  const checkedToday = sets.checked.has(todayKey)
  const frozenToday = !checkedToday && sets.frozen.has(todayKey)
  const streakDays = countStreakDays(sets.checked, today, sets.kept)
  const totalDays = sets.checked.size
  const tone = checkedToday ? 'active' : frozenToday ? 'frozen' : 'idle'
  const task = buildTodayTask({ todayCheckin, checkedToday, frozenToday, reward })

  return {
    header: { title: '学习连胜' },
    hero: {
      label: '已连续学习',
      stateLabel: checkedToday ? '今天也保持住了' : frozenToday ? '今天已冻结，连胜不会断' : '今天还没打卡',
      tone,
      animationSrc: checkedToday ? '/learning/assets/check-in/streak.svg' : '/learning/assets/check-in/streak-gray.svg',
      cornerSquares: CORNER_SQUARES
    },
    streak: {
      days: streakDays,
      totalDays: [...sets.checked].filter((key) => key.startsWith(monthPrefix)).length,
      streakWeeks: countStreakWeeks(sets.kept, today, year, month),
      coinsEarned: wholeNumber(coinsEarned)
    },
    calendar: buildCalendar(sets, today, year, month),
    task,
    cards: buildCards({ cards, cardRules, freezePlan, revivable, sets, todayKey, streakDays }),
    checkedToday,
    action: checkedToday
      ? { state: 'checked-in', label: '分享一下' }
      : { state: 'not-checked-in', label: '去学一节课' },
    successSheet: {
      title: '打卡成功',
      subtitle: task.earned ? `今天的学习火花已点亮 · +${task.earned} 金币` : '今天的学习火花已点亮',
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

// 学习连胜入口（四个 tab 页顶栏的火苗、「我的」页的连胜卡片）用的摘要：点亮状态、连续天数、今日提示与本周七天。
// 点亮 = 今天已打卡，图标与打卡页顶部的火花一致（点亮 streak.svg / 未点亮 streak-gray.svg，两种都会动）。
function buildStreakSummary({ today: todayKey, checkedDates = [], frozenDates = [], revivedDates = [] } = {}) {
  const today = parseDay(todayKey)
  if (!today) throw new Error('打卡日期无效')
  const sets = daySets({ today: todayKey, checkedDates, frozenDates, revivedDates })
  const lit = sets.checked.has(todayKey)
  const frozenToday = !lit && sets.frozen.has(todayKey)
  const start = weekStart(today)
  return {
    today: todayKey,
    lit,
    frozen: frozenToday,
    streakDays: countStreakDays(sets.checked, today, sets.kept),
    iconSrc: lit ? '/learning/assets/check-in/streak.svg' : '/learning/assets/check-in/streak-gray.svg',
    stateLabel: lit ? '今天也保持住了' : frozenToday ? '今天已冻结，连胜不会断' : '学完一节课就能点亮今天',
    week: WEEKDAYS.map((label, offset) => {
      const key = dayKey(addDays(start, offset))
      const isChecked = sets.checked.has(key)
      const isFrozen = !isChecked && sets.frozen.has(key)
      return {
        id: key, label, date: Number(key.slice(8)), isChecked, isFrozen,
        isRevived: !isChecked && !isFrozen && sets.revived.has(key),
        isToday: key === todayKey, isFuture: key > todayKey
      }
    })
  }
}

module.exports = { buildCheckInModel, buildStreakSummary, countStreakDays, countStreakWeeks, streakDaysOf, dateRange, parseDay }
