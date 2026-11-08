const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')

const pagePath = require.resolve('../pages/home/index.js')

test('home follows the designer layout: score tools and member courses, no agent composer', () => {
  const template = readFileSync(require.resolve('../pages/home/index.wxml'), 'utf8')

  assert.doesNotMatch(template, /agent-composer|sendPrompt/)
  assert.match(template, /wx:for="{{primaryTools}}"/)
  assert.match(template, /wx:for="{{secondaryToolPages}}"/)
  assert.match(template, /bindtap="handleScoreToolTap"/)
  assert.match(template, /会员课程/)
  assert.match(template, /bindrefresherrefresh="handleRefresh"/)
})

function loadPage({ live } = {}) {
  delete require.cache[pagePath]
  const servicePath = require.resolve('../services/live-tab-service.js')
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: { getLiveHomeModel: live || (async () => ({ model: { notifications: { count: 0 }, moreCourses: [] }, dashboard: {} })) }
  }

  let definition = null
  const navigations = []
  const toasts = []
  global.Page = (page) => { definition = page }
  global.getApp = () => ({})
  global.wx = {
    navigateTo(options) { navigations.push(options) },
    showToast(options) { toasts.push(options) }
  }
  require(pagePath)
  delete require.cache[servicePath]

  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) }
  }
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === 'function') instance[key] = value
  }
  return { definition, instance, navigations, toasts }
}

test('every score tool uses its backend icon; live tools open their page, the rest are coming soon', () => {
  const template = readFileSync(require.resolve('../pages/home/index.wxml'), 'utf8')
  const { instance, toasts, navigations } = loadPage()
  const tools = [...instance.data.primaryTools, ...instance.data.secondaryToolPages.flat()]

  assert.equal(tools.length, 7)
  assert.match(template, /UA\.src\(ui, '\/assets\/home\/score-tools\/' \+ \(item\.id\) \+ '\.png'\)/)
  assert.match(template, /data-id="{{item\.id}}" data-label="{{item\.label}}" bindtap="handleScoreToolTap"/)
  assert.match(template, /data-id="{{tool\.id}}" data-label="{{tool\.label}}" bindtap="handleScoreToolTap"/)

  instance.data.model.access = 'ready'
  instance.handleScoreToolTap({ currentTarget: { dataset: { id: 'error-diagnosis', label: '错因诊断' } } })
  assert.deepEqual(navigations, [{ url: '/score-tools/tool/index?tool=error-diagnosis' }])
  instance.handleScoreToolTap({ currentTarget: { dataset: { id: 'paper-analysis', label: '试卷复盘' } } })
  assert.deepEqual(toasts, [{ title: '试卷复盘即将上线', icon: 'none' }])
})

test('a guest tapping a live score tool is sent to log in first', () => {
  const { instance, navigations } = loadPage()
  instance.data.model.access = 'guest'
  instance.handleScoreToolTap({ currentTarget: { dataset: { id: 'question-review', label: '审题拆解' } } })
  assert.equal(navigations.length, 1)
  assert.doesNotMatch(navigations[0].url, /score-tools/)
})

test('the secondary tool swiper has no placeholder page', () => {
  const { instance } = loadPage()
  assert.equal(instance.data.secondaryToolPages.length, 1)
  assert.ok(instance.data.secondaryToolPages[0].every((tool) => !tool.placeholder))
})

test('home keeps only the latest live model when loads overlap', async () => {
  let resolveFirst
  const calls = []
  const { instance } = loadPage({
    live: () => new Promise((resolve) => {
      calls.push(resolve)
      if (calls.length === 1) resolveFirst = resolve
    })
  })

  const first = instance.loadModel()
  const second = instance.loadModel()
  calls[1]({ model: { notifications: { count: 2 }, moreCourses: [] }, dashboard: {} })
  await second
  resolveFirst({ model: { notifications: { count: 9 }, moreCourses: [] }, dashboard: {} })
  await first

  assert.equal(instance.data.model.notifications.count, 2)
})

test('home top bar shows the learning streak entry and the course heading opens the member catalog', () => {
  const template = readFileSync(require.resolve('../pages/home/index.wxml'), 'utf8')
  const { instance, navigations } = loadPage()

  // 顶栏胶囊左边是学习连胜入口（components/streak-entry），不再是消息入口；消息中心在「我的 → 常用入口」。
  assert.match(template, /<streak-entry top="\{\{streakEntryTop\}\}" right="\{\{streakEntryRight\}\}" size="\{\{menuButtonHeight\}\}" \/>/)
  assert.doesNotMatch(template, /showNotifications|topbar\/message\.png/)
  instance.openMembershipCatalog()

  assert.deepEqual(navigations, [{ url: '/learning/library/index' }])
})
