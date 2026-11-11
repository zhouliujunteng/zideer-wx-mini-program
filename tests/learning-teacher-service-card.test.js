const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

// 2026-09-25 用户要求：「我的 › 知鹿服务」里的企微服务卡片移到学习页「我的课程」标题下、搜索框上，改名「联系老师定制课程」。
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

function setup(contactResult, { session = true } = {}) {
  let definition
  const navigations = []
  const openedContacts = []
  global.wx = { navigateTo: (options) => navigations.push(options.url) }
  vm.runInNewContext(read('pages/learning/index.js'), {
    Page(p) { definition = p },
    getApp: () => ({}),
    setTimeout: () => 0,
    clearTimeout() {},
    wx: { showToast() {}, navigateTo: (options) => navigations.push(options.url) },
    require(name) {
      if (name.endsWith('/identity')) return { loadCurrentServiceContacts: async () => contactResult, hasSession: () => session, loadQuestPath: async () => null }
      if (name.endsWith('/utils/quest-path-view')) return require('../utils/quest-path-view')
      if (name.endsWith('/utils/access-gate')) return require('../utils/access-gate')
      if (name.endsWith('/customer-service')) return { openCustomerServiceChat: async (contact) => { openedContacts.push(contact) }, customerServiceErrorMessage: () => '' }
      if (name.endsWith('/live-tab-service')) return { getLiveLearningModel: async () => ({ model: { myCourses: [] }, dashboard: {} }), getLearningSkeletonModel: () => ({}) }
      if (name.endsWith('/agent-course-focus')) return { takeAgentCourseFocus: () => '' }
      if (name.endsWith('/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/utils/my-course-groups')) return require('../utils/my-course-groups')
      if (name.endsWith('/services/achievement-cards')) return { loadAchievementCards: async () => ({ series: [] }), stripCards: () => [] }
      if (name.endsWith('/payment-switch')) return { attachPaymentSwitch() {}, openPaymentPage() {} }
      throw Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  return { page, navigations, openedContacts }
}

const contact = { id: 'service-1', corpId: 'ww1234567890abcdef', targetRef: 'https://work.weixin.qq.com/kfid/kfc1234567890abcdef' }

test('the teacher card opens the single preloaded WeChat customer-service chat directly', async () => {
  const { page, navigations, openedContacts } = setup({ status: 'ready', contacts: [contact] })
  await page.onShow()
  await page.openEnterpriseService()
  assert.deepEqual(openedContacts, [contact])
  assert.deepEqual(navigations, [])
})

test('the teacher card falls back to the service-contact page when there is no single contact', async () => {
  const { page, navigations, openedContacts } = setup({ status: 'no_active_contacts', contacts: [] })
  await page.onShow()
  await page.openEnterpriseService()
  assert.deepEqual(openedContacts, [])
  assert.deepEqual(navigations, ['/account/service-contact/index'])
})

// 2026-11-11 晚：学习页只留闯关路径，联系老师收进顶栏的头像入口（还没有课时空状态里也有一个按钮）
test('the teacher entry sits in the top stats row, renamed', () => {
  const learning = read('pages/learning/index.wxml')
  assert.match(learning, /class="lp-stat" bindtap="openEnterpriseService" role="button" aria-label="联系老师定制课程"/)
  assert.ok(learning.indexOf('openEnterpriseService') < learning.indexOf('<scroll-view'), 'entry must be in the top bar')
  assert.doesNotMatch(learning.replace(/<!--[\s\S]*?-->/g, ''), /企微服务/)
})

// 卡片点进来的服务入口页标题跟着改名（会员页、结算页的「联系服务人员」也进这一页）
test('the service-contact page is titled like the card', () => {
  assert.equal(JSON.parse(read('account/service-contact/index.json')).navigationBarTitleText, '联系老师定制课程')
})

test('the 我的 page no longer shows the enterprise service card', () => {
  assert.doesNotMatch(read('pages/me/index.wxml'), /enterprise-service/)
  assert.doesNotMatch(read('pages/me/index.js'), /openEnterpriseService/)
  const { meModel } = require('../data/mock/tab-data.js')
  assert.ok(meModel.serviceGroups.every((group) => !group.enterpriseService))
})

// 2026-09-27 用户规则：未登录也能浏览学习页；游客点「联系老师定制课程」先去登录，不读客服入口。
test('a guest tapping the teacher card is sent to login without reading contacts', async () => {
  const { page, navigations, openedContacts } = setup({ status: 'ready', contacts: [contact] }, { session: false })
  await page.onShow()
  assert.equal(page.data.enterpriseContacts.length, 0)
  await page.openEnterpriseService()
  assert.equal(openedContacts.length, 0)
  assert.deepEqual(navigations, ['/pages/login/login'])
})
