// 「今日打卡完成」弹窗（components/checkin-celebration）与费曼验收页的接线（2026-09-25）。
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')
require('./helpers/stub-ui-assets')

function loadComponent() {
  const path = require.resolve('../components/checkin-celebration/index.js')
  delete require.cache[path]
  let definition = null
  global.Component = (value) => { definition = value }
  const calls = { navigate: [], events: [] }
  global.wx = { navigateTo: (options) => calls.navigate.push(options.url) }
  require(path)
  const component = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) },
    triggerEvent(name) { calls.events.push(name) }
  }
  for (const [key, value] of Object.entries(definition.methods)) component[key] = value
  component.setNotice = (notice) => definition.observers.notice.call(component, notice)
  return { component, calls }
}

test('the popup shows the streak, coins and cards from a confirmed check-in', () => {
  const { component } = loadComponent()
  component.setNotice({
    status: 'checked_in', sourceKind: 'acceptance_passed', title: '一元一次方程', rewardCoins: 20, streakDays: 7,
    cards: [{ cardType: 'freeze', title: '', count: 1 }, { cardType: 'gold', count: 3 }]
  })
  const view = component.data.view
  assert.equal(view.confirmed, true)
  assert.equal(view.subtitle, '《一元一次方程》费曼验收通过，今天的学习火苗点亮了')
  assert.deepEqual([view.streakDays, view.rewardCoins], [7, 20])
  assert.deepEqual(view.cards, [{ type: 'freeze', title: '冻结卡', count: 1, iconSrc: '/learning/assets/check-in/card-freeze.svg' }])
})

test('a pending check-in says it was recorded without numbers, and junk shows nothing', () => {
  const { component } = loadComponent()
  component.setNotice({ status: 'pending', sourceKind: 'lesson_completed', title: '' })
  assert.deepEqual([component.data.view.confirmed, component.data.view.subtitle], [false, '学完一节课，今天的学习火苗点亮了'])
  component.setNotice({ status: 'whatever' })
  assert.equal(component.data.view, null)
})

test('view goes to the streak page and both buttons close the popup', () => {
  const { component, calls } = loadComponent()
  component.setNotice({ status: 'checked_in', sourceKind: 'lesson_completed' })
  component.handleView()
  assert.deepEqual(calls.navigate, ['/learning/check-in/index'])
  assert.equal(component.data.view, null)
  component.setNotice({ status: 'checked_in', sourceKind: 'lesson_completed' })
  component.handleClose()
  assert.deepEqual(calls.events, ['close', 'close'])
})

test('the acceptance page celebrates when the answer lights today and refreshes the streak entries', () => {
  const script = readFileSync(require.resolve('../learning/agent-acceptance/index.js'), 'utf8')
  assert.match(script, /if \(result\.checkin\) this\.celebrate\(result\.checkin\)/)
  assert.match(script, /loadCheckin\(\{ maxAge: 0 \}\)/)
  const template = readFileSync(require.resolve('../learning/agent-acceptance/index.wxml'), 'utf8')
  assert.match(template, /<checkin-celebration notice="\{\{checkinNotice\}\}"/)
  const config = JSON.parse(readFileSync(require.resolve('../learning/agent-acceptance/index.json'), 'utf8'))
  assert.equal(config.usingComponents['checkin-celebration'], '/components/checkin-celebration/index')
})
