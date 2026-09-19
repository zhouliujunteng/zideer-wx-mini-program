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

test('every score tool uses its backend icon and announces it is coming soon', () => {
  const template = readFileSync(require.resolve('../pages/home/index.wxml'), 'utf8')
  const { instance, toasts } = loadPage()
  const tools = [...instance.data.primaryTools, ...instance.data.secondaryToolPages.flat()]

  assert.equal(tools.length, 7)
  assert.match(template, /UA\.src\(ui, '\/assets\/home\/score-tools\/' \+ \(item\.id\) \+ '\.png'\)/)
  instance.handleScoreToolTap({ currentTarget: { dataset: { label: '错因诊断' } } })
  assert.deepEqual(toasts, [{ title: '错因诊断即将上线', icon: 'none' }])
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

test('home top bar opens messages and the course heading opens the member catalog', () => {
  const { instance, navigations } = loadPage()

  instance.showNotifications()
  instance.openMembershipCatalog()

  assert.deepEqual(navigations, [
    { url: '/pages/messages/index' },
    { url: '/commerce/products/index' }
  ])
})
