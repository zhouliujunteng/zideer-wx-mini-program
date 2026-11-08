const assert = require('node:assert/strict')
const test = require('node:test')
const { buildCheckInModel } = require('../services/checkin-model')

// 2026-09-19 是星期六；本周为 09-13（日）至 09-19（六）。
const TODAY = '2026-09-19'

test('streak counts back from today once today is checked in', () => {
  const model = buildCheckInModel({ today: TODAY, checkedDates: ['2026-09-17', '2026-09-18', '2026-09-19'] })
  assert.equal(model.streak.days, 3)
  assert.equal(model.checkedToday, true)
  assert.equal(model.hero.tone, 'active')
  assert.deepEqual(model.action, { state: 'checked-in', label: '分享一下' })
})

test('before studying today the streak still counts up to yesterday', () => {
  const model = buildCheckInModel({ today: TODAY, checkedDates: ['2026-09-16', '2026-09-17', '2026-09-18'] })
  assert.equal(model.streak.days, 3)
  assert.equal(model.checkedToday, false)
  assert.equal(model.hero.stateLabel, '今天还没打卡')
  assert.deepEqual(model.action, { state: 'not-checked-in', label: '去学一节课' })
})

test('a missed day breaks the streak', () => {
  const model = buildCheckInModel({ today: TODAY, checkedDates: ['2026-09-15', '2026-09-16', '2026-09-18', '2026-09-19'] })
  assert.equal(model.streak.days, 2)
  assert.equal(buildCheckInModel({ today: TODAY, checkedDates: ['2026-09-17'] }).streak.days, 0)
})

test('streak weeks count consecutive Sunday-to-Saturday weeks with at least one check-in', () => {
  // 本周(09-13..19)、上周(09-06..12)、再上周(08-30..09-05) 各至少一次，08-23..29 这周没有。
  const dates = ['2026-09-14', '2026-09-08', '2026-08-31', '2026-08-20']
  assert.equal(buildCheckInModel({ today: TODAY, checkedDates: dates }).streak.streakWeeks, 3)
})

test('when this week has no check-in yet, streak weeks start from last week', () => {
  const model = buildCheckInModel({ today: '2026-09-14', checkedDates: ['2026-09-08', '2026-09-01'] })
  assert.equal(model.streak.streakWeeks, 2)
})

test('viewing a past month shows that month\'s totals and weeks ending at its last week', () => {
  const dates = ['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-25', '2026-09-02']
  const august = buildCheckInModel({ today: TODAY, checkedDates: dates, viewedYear: 2026, viewedMonth: 8 })
  assert.equal(august.streak.totalDays, 4)
  // 08-30..09-05 是八月最后一周（含 09-02），08-23..29 有 08-25，08-16..22 没有。
  assert.equal(august.streak.streakWeeks, 2)
  assert.equal(august.calendar.monthLabel, '2026年8月')
  assert.equal(august.calendar.canGoNext, true)
  assert.equal(buildCheckInModel({ today: TODAY, checkedDates: dates }).calendar.canGoNext, false)
  assert.equal(buildCheckInModel({ today: TODAY, checkedDates: dates }).successSheet.totalDays, 5)
})

test('calendar marks each checked day on its own, consecutive days are not joined into a band', () => {
  const model = buildCheckInModel({ today: TODAY, checkedDates: ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-15'] })
  const day = (key) => model.calendar.days.find((item) => item.id === key)
  assert.deepEqual(['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15'].map((key) => day(key).isMarked), [true, true, true, false, true])
  assert.ok(model.calendar.days.every((item) => !('isRunStart' in item) && !('isRunMiddle' in item) && !('isRunEnd' in item)))
  assert.equal(day('2026-09-19').isToday, true)
  assert.equal(day('2026-09-20').isFuture, true)
  // 2026 年 9 月 1 日是周二：前面补 2 格上月日期，共 5 行。
  assert.equal(model.calendar.days[0].id, '2026-08-30')
  assert.equal(model.calendar.rowCount, 5)
  assert.equal(model.calendar.height, 82 + 5 * 94)
})

test('dates after today from the server are ignored', () => {
  const model = buildCheckInModel({ today: TODAY, checkedDates: ['2026-09-19', '2026-09-20'] })
  assert.equal(model.successSheet.totalDays, 1)
})

test('share copy and poster use the real nickname and streak', () => {
  const model = buildCheckInModel({ today: TODAY, checkedDates: ['2026-09-18', '2026-09-19'], nickname: ' 小鹿 ' })
  assert.equal(model.shareCard.posterNickname, '小鹿')
  assert.equal(model.successSheet.shareCopy, '我已在知鹿连续学习 2 天')
  assert.equal(model.successSheet.posterWeekday, '星期六')
  assert.equal(buildCheckInModel({ today: TODAY }).shareCard.posterNickname, '知鹿学习者')
})

test('the hero pixel grid follows the designer row spec', () => {
  const squares = buildCheckInModel({ today: TODAY }).hero.cornerSquares
  assert.equal(squares.length, 269)
  assert.ok(squares.every((item) => item.opacity >= 0.03 && item.activeOpacity <= 0.62))
})

// ---- 2026-09-25：打卡改为学完一节课或费曼验收通过；冻结卡、复活卡 ----
// 与 Zion 端 scripts/learning-streak/zion/streak-flows.test.mjs 同一组数据（那边的「今天」是 2026-09-25）。
const SEP25 = '2026-09-25'

test('frozen and revived days bridge the streak but do not add to it', () => {
  const model = buildCheckInModel({
    today: SEP25,
    checkedDates: ['2026-09-20', '2026-09-21', '2026-09-24'],
    frozenDates: ['2026-09-22'],
    revivedDates: ['2026-09-23']
  })
  assert.equal(model.streak.days, 3)
  assert.equal(buildCheckInModel({ today: SEP25, checkedDates: ['2026-09-20', '2026-09-21', '2026-09-24'] }).streak.days, 1)
  const day = (key) => model.calendar.days.find((item) => item.id === key)
  assert.deepEqual([day('2026-09-22').isFrozen, day('2026-09-22').isChecked, day('2026-09-22').isMarked], [true, false, true])
  assert.equal(day('2026-09-23').isRevived, true)
  assert.deepEqual(model.calendar.legend, { frozen: true, revived: true })
})

test('a frozen today keeps the streak alive and shows the frozen hero', () => {
  const model = buildCheckInModel({ today: SEP25, checkedDates: ['2026-09-23', '2026-09-24'], frozenDates: [SEP25, '2026-09-26', '2026-09-27'] })
  assert.equal(model.streak.days, 2)
  assert.equal(model.hero.tone, 'frozen')
  assert.equal(model.hero.stateLabel, '今天已冻结，连胜不会断')
  assert.equal(model.task.frozen, true)
  const day = (key) => model.calendar.days.find((item) => item.id === key)
  assert.deepEqual([day('2026-09-26').isFrozen, day('2026-09-26').isFuture], [true, true], '还没到的冻结日也画出来')
  assert.equal(model.cards.find((card) => card.type === 'freeze').statusLabel, '冻结中 · 9月25日–27日')
  // 冻结一直到昨天、今天还没打卡：连胜仍然在
  assert.equal(buildCheckInModel({ today: SEP25, checkedDates: ['2026-09-22'], frozenDates: ['2026-09-23', '2026-09-24'] }).streak.days, 1)
})

test('the task card is one row: study a lesson or pass a Feynman acceptance, then a check mark', () => {
  const task = (checkin) => buildCheckInModel({ today: SEP25, ...checkin }).task
  assert.deepEqual(task({}), { label: '学完一节课、通过验收或完成一次复习', complete: false, frozen: false, earned: 0, coinHint: '', action: '去学习 ›' })
  const lesson = task({ checkedDates: [SEP25], todayCheckin: { source: 'lesson_completed', title: '分数的加法', rewardCoins: 20 } })
  assert.deepEqual([lesson.complete, lesson.action, lesson.earned], [true, '', 20])
  assert.deepEqual([task({ checkedDates: [SEP25], todayCheckin: { source: 'acceptance_passed', rewardCoins: 0 } }).complete], [true])
  // 旧规则（5 分钟）点亮的那天也算打过卡
  assert.equal(task({ checkedDates: [SEP25], todayCheckin: { source: 'learning_time', rewardCoins: 0 } }).complete, true)
  const frozen = task({ checkedDates: ['2026-09-24'], frozenDates: [SEP25] })
  assert.deepEqual([frozen.complete, frozen.frozen, frozen.action], [false, true, '去学习 ›'])
})

test('the task row tells how many coins today, or tomorrow once checked in, will bring', () => {
  const hint = (checkin) => buildCheckInModel({ today: SEP25, ...checkin }).task.coinHint
  const reward = (nextDay, nextCoins, enabled = true) => ({ enabled, coins: 20, nextDay, nextCoins })
  assert.equal(hint({ checkedDates: ['2026-09-23', '2026-09-24'], reward: reward('today', 40) }), '+40 金币', '还没打卡：今天打卡能拿多少')
  assert.equal(hint({ checkedDates: ['2026-09-24', SEP25], reward: reward('tomorrow', 40) }), '明天 +40 金币', '打过卡：明天接着打能拿多少')
  assert.equal(hint({ checkedDates: ['2026-09-24'], frozenDates: [SEP25], reward: reward('today', 30) }), '+30 金币', '今天冻结着也提示')
  assert.equal(hint({ reward: reward('today', 20, false) }), '', '活动关着不提示')
  assert.equal(hint({ reward: reward('today', 0) }), '')
  assert.equal(hint({}), '', '旧后端没有这一项')
  assert.equal(hint({ checkedDates: [SEP25], reward: reward('today', 40) }), '', '后端说今天、页面说已打卡：对不上就不提示')
})

test('coins earned from the streak are shown on the page', () => {
  assert.equal(buildCheckInModel({ today: SEP25, coinsEarned: 240 }).streak.coinsEarned, 240)
  assert.equal(buildCheckInModel({ today: SEP25, coinsEarned: -5 }).streak.coinsEarned, 0)
  const sheet = buildCheckInModel({ today: SEP25, checkedDates: [SEP25], todayCheckin: { source: 'lesson_completed', rewardCoins: 20 } }).successSheet
  assert.equal(sheet.subtitle, '今天的学习火花已点亮 · +20 金币')
})

const cardConfig = [
  { type: 'freeze', title: '冻结卡', description: '', count: 2, effectDays: 3, windowDays: 0, enabled: true },
  { type: 'revive', title: '复活卡', description: '', count: 1, effectDays: 2, windowDays: 7, enabled: true }
]

test('cards say whether they can be used and what they would do', () => {
  const model = buildCheckInModel({
    today: SEP25, checkedDates: ['2026-09-21', '2026-09-24'], cards: cardConfig,
    freezePlan: [SEP25, '2026-09-26', '2026-09-27'], revivable: { dates: ['2026-09-22', '2026-09-23'] },
    cardRules: [{ cardType: 'freeze', trigger: 'streak_days', days: 7, repeat: 'every', count: 1 }, { cardType: 'revive', trigger: 'total_days', days: 1, repeat: 'once', count: 1 }]
  })
  const [freeze, revive] = model.cards
  assert.deepEqual([freeze.usable, freeze.count, freeze.reason, freeze.lit], [true, 2, '冻结 9月25日–27日，共 3 天', true])
  assert.equal(freeze.description, '冻结 3 天，这几天不打卡也不会断连胜')
  assert.deepEqual(freeze.howToGet, ['每连续打卡 7 天送 1 张'], '本页不做激活码入口')
  assert.equal(freeze.iconSrc, '/learning/assets/check-in/card-freeze.svg')
  assert.deepEqual([revive.usable, revive.reason, revive.description], [true, '补回 9月22日–23日，共 2 天', '连胜断了 7 天内可用，补回最多 2 天'])
  assert.deepEqual(revive.howToGet, ['第一次打卡送 1 张'])
})

test('cards explain why they cannot be used', () => {
  const noStreak = buildCheckInModel({ today: SEP25, cards: cardConfig })
  assert.deepEqual(noStreak.cards.map((card) => [card.usable, card.reason]), [[false, '有连胜时才能用'], [false, '连胜没有断，暂时用不上']])
  const empty = buildCheckInModel({ today: SEP25, checkedDates: [SEP25], cards: cardConfig.map((card) => ({ ...card, count: 0 })), freezePlan: ['2026-09-26'] })
  assert.deepEqual(empty.cards.map((card) => [card.usable, card.reason, card.lit]), [[false, '还没有冻结卡', false], [false, '还没有复活卡', false]], '没卡：灰色卡牌')
  const off = buildCheckInModel({ today: SEP25, checkedDates: [SEP25], cards: cardConfig.map((card) => ({ ...card, enabled: false })), freezePlan: ['2026-09-26'] })
  assert.deepEqual(off.cards.map((card) => card.reason), ['暂未开放', '暂未开放'])
  // 后端还没配道具卡：两张卡都显示，但用不了
  assert.deepEqual(buildCheckInModel({ today: SEP25 }).cards.map((card) => [card.type, card.usable]), [['freeze', false], ['revive', false]])
})

test('date ranges read naturally across months', () => {
  const { dateRange } = require('../services/checkin-model')
  assert.equal(dateRange(['2026-09-26']), '9月26日')
  assert.equal(dateRange(['2026-09-28', '2026-09-26', '2026-09-27']), '9月26日–28日')
  assert.equal(dateRange(['2026-09-30', '2026-10-02']), '9月30日–10月2日')
})

test('the streak summary for the entries follows the same rule', () => {
  const { buildStreakSummary, streakDaysOf } = require('../services/checkin-model')
  const checkin = { today: SEP25, checkedDates: ['2026-09-21', '2026-09-24'], frozenDates: ['2026-09-22', SEP25], revivedDates: ['2026-09-23'] }
  const summary = buildStreakSummary(checkin)
  assert.deepEqual([summary.lit, summary.frozen, summary.streakDays, summary.stateLabel], [false, true, 2, '今天已冻结，连胜不会断'])
  const week = Object.fromEntries(summary.week.map((day) => [day.id, day]))
  assert.deepEqual([week['2026-09-22'].isFrozen, week['2026-09-23'].isRevived, week['2026-09-24'].isChecked], [true, true, true])
  assert.equal(streakDaysOf(checkin), 2)
  assert.equal(buildStreakSummary({ today: SEP25, checkedDates: [] }).stateLabel, '学完一节课就能点亮今天')
})
