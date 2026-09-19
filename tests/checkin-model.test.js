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
  assert.deepEqual(model.action, { state: 'not-checked-in', label: '立刻学习' })
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

test('calendar runs join consecutive days and break at week boundaries', () => {
  const model = buildCheckInModel({ today: TODAY, checkedDates: ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-15'] })
  const day = (key) => model.calendar.days.find((item) => item.id === key)
  // 09-12 是周六、09-13 是周日：色带在周末处断开。
  assert.deepEqual([day('2026-09-11').isRunStart, day('2026-09-11').isRunEnd], [true, false])
  assert.deepEqual([day('2026-09-12').isRunStart, day('2026-09-12').isRunEnd], [false, true])
  assert.deepEqual([day('2026-09-13').isRunStart, day('2026-09-13').isRunEnd], [true, true])
  assert.deepEqual([day('2026-09-15').isRunStart, day('2026-09-15').isRunEnd], [true, true])
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
