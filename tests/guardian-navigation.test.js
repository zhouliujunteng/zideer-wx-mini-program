const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 2026-09-25 用户规则：家长底栏只有四项（没有「图谱」）；已绑定学生的家长「常用入口」里「测评中心」换成「学生看板」。
const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

function tabBar(accountType, route) {
  let definition
  const storage = { zhilu_account_type: accountType }
  const switched = []
  const wx = { getStorageSync: (key) => storage[key], switchTab: ({ url }) => switched.push(url) }
  vm.runInNewContext(read('custom-tab-bar/index.js'), {
    Component(value) { definition = value },
    getCurrentPages: () => [{ route }],
    wx,
    require: (name) => {
      if (name.endsWith('/utils/account-role')) {
        const module = { exports: {} }
        vm.runInNewContext(read('utils/account-role.js'), { module, wx })
        return module.exports
      }
      throw new Error('Unexpected import ' + name)
    }
  })
  const bar = { data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) }, ...definition.methods }
  definition.lifetimes.attached.call(bar)
  return { bar, storage, switched, show: () => definition.pageLifetimes.show.call(bar) }
}

test('students keep five tabs; guardians get four without 目标', () => {
  assert.deepEqual(tabBar('student', 'pages/home/index').bar.data.tabs.map((tab) => tab.text), ['首页', '学习', '宇宙', '目标', '我的'])
  assert.deepEqual(tabBar('', 'pages/home/index').bar.data.tabs.map((tab) => tab.text), ['首页', '学习', '宇宙', '目标', '我的'])
  const guardian = tabBar('guardian', 'pages/me/index')
  assert.deepEqual(guardian.bar.data.tabs.map((tab) => tab.text), ['首页', '学习', '宇宙', '我的'])
  assert.equal(guardian.bar.data.selected, 'pages/me/index')
})

test('the tab bar follows an identity switch the next time the page shows, and switches tabs by route', () => {
  const { bar, storage, show, switched } = tabBar('student', 'pages/me/index')
  storage.zhilu_account_type = 'guardian'
  show()
  assert.equal(bar.data.tabs.length, 4)
  bar.handleTap({ currentTarget: { dataset: { route: 'pages/me/index' } } })
  bar.handleTap({ currentTarget: { dataset: { route: 'pages/knowledge-universe/index' } } })
  assert.deepEqual(switched, ['/pages/knowledge-universe/index'])
})

test('app.json uses the custom tab bar and still declares every tab page with its package icons', () => {
  const app = JSON.parse(read('app.json'))
  assert.equal(app.tabBar.custom, true)
  const code = read('custom-tab-bar/index.js')
  for (const item of app.tabBar.list) {
    assert.ok(code.includes(`route: '${item.pagePath}'`), item.pagePath)
    assert.ok(code.includes(`'/${item.iconPath}'`) && code.includes(`'/${item.selectedIconPath}'`), item.iconPath)
  }
  // 五个 tab 页 onShow 都通知底栏选中自己
  for (const page of ['home', 'learning', 'knowledge-universe', 'knowledge-map', 'me']) assert.match(read(`pages/${page}/index.js`), new RegExp(`markTabVisible\\('pages/${page}/index'\\)`))
})

test('a guardian who lands on 图谱 is sent home before the map loads', () => {
  const code = read('pages/knowledge-map/index.js')
  const onShow = code.slice(code.indexOf('async onShow() {'))
  assert.ok(onShow.indexOf("if (isGuardianAccount()) { wx.switchTab({ url: '/pages/home/index' }); return }") < onShow.indexOf('loadKnowledgeMapCourse'))
})

function liveService({ accountType, children, profileType }) {
  const module = { exports: {} }
  const storage = { zhilu_account_type: accountType }
  const wx = { getStorageSync: (key) => storage[key], setStorageSync: (key, value) => { storage[key] = value } }
  vm.runInNewContext(read('services/live-tab-service.js'), {
    module,
    require: (name) => {
      if (name === './mock-service') return { getMeModel: () => ({ profile: {}, accountSummary: [{}, {}], quickActions: [{ label: '测评中心', icon: 'a' }, { label: '消息中心', icon: 'b' }] }) }
      if (name === '../utils/account-role') {
        const role = { exports: {} }
        vm.runInNewContext(read('utils/account-role.js'), { module: role, wx })
        return role.exports
      }
      if (name === './identity') return {
        loadMeDashboard: async () => ({ profile: { displayName: '鹿妈妈', publicId: '100001', accountType: profileType }, balances: {} }),
        loadCurrentGrowthCenter: async () => null,
        loadCurrentFamilyRelations: async () => { if (children instanceof Error) throw children; return { students: children } }
      }
      return {}
    }
  })
  return { service: module.exports, storage }
}

test('a guardian with an active child sees 学生看板 in place of 测评中心', async () => {
  const { service, storage } = liveService({ accountType: 'guardian', profileType: 'guardian', children: [{ status: 'active', expires_at: null }] })
  const model = await service.getLiveMeModel()
  assert.deepEqual(Array.from(model.quickActions, (item) => item.label), ['学生看板', '消息中心'])
  assert.equal(model.quickActions[0].icon, '../../assets/me/quick-student-dashboard.svg')
  assert.equal(storage.zhilu_guardian_has_children, true)
})

test('students, unbound guardians and expired relations keep 测评中心', async () => {
  for (const options of [
    { accountType: 'student', profileType: 'student', children: [{ status: 'active' }] },
    { accountType: 'guardian', profileType: 'guardian', children: [] },
    { accountType: 'guardian', profileType: 'guardian', children: [{ status: 'active', expires_at: '2020-01-01T00:00:00Z' }] }
  ]) {
    const model = await liveService(options).service.getLiveMeModel()
    assert.equal(model.quickActions[0].label, '测评中心', JSON.stringify(options))
  }
})

test('the 我的 page routes 学生看板 to the guardian dashboard', () => {
  assert.match(read('pages/me/index.js'), /'学生看板': '\/account\/guardian-dashboard\/index'/)
  // 首屏按上次记下的身份画入口，不先闪「测评中心」
  assert.match(read('pages/me/index.js'), /withGuardianQuickActions\(model\.quickActions, isGuardianAccount\(\) && readGuardianHasChildren\(\)\)/)
})
