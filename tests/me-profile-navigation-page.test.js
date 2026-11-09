const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../pages/me/index.js')

function loadPage() {
  delete require.cache[pagePath]
  let definition = null
  const navigations = []
  global.Page = (page) => { definition = page }
  global.getApp = () => ({ globalData: {} })
  global.wx = { navigateTo: (options) => navigations.push(options), showToast() {}, getStorageSync: (key) => key === 'zion_runtime_token' ? 'signed-in-token' : '' }
  require(pagePath)
  return { definition, navigations }
}

test('profile header and learning profile entry both open the editable learning profile', () => {
  const { definition, navigations } = loadPage()
  const instance = { data: {}, setData() {} }

  definition.handleEntry.call(instance, { currentTarget: { dataset: { id: 'learningProfile' } } })

  assert.deepEqual(navigations, [{ url: '/pages/profile-setup/index?edit=1' }])
})

test('the learning-device entry is gone together with its page', () => {
  // 2026-09-27 起课程只能从小程序进入：学习设备确认（网页显示确认码、回小程序确认本人）整个下线，
  // 入口和页面一起删；进课换不到入场券时课程页直接报错重试，不再退到要确认设备的网页。
  const { definition, navigations } = loadPage()
  const { meModel } = require('../data/mock/tab-data.js')
  const titles = (meModel.serviceGroups || []).flatMap((group) => (group.items || []).map((item) => item.title))
  assert.ok(!titles.includes('学习设备'), `学习设备 entry is back in: ${titles.join(', ')}`)

  definition.handleItem.call({ data: {}, setData() {} }, { currentTarget: { dataset: { name: '学习设备' } } })
  assert.deepEqual(navigations, [])

  const app = require('../app.json')
  const learningPages = app.subpackages.find((item) => item.root === 'learning').pages
  assert.ok(!learningPages.includes('device-confirm/index'))
})

test('the about entry is listed and opens the about page, which links the user agreement', () => {
  const { definition, navigations } = loadPage()
  const { meModel } = require('../data/mock/tab-data.js')
  const titles = (meModel.serviceGroups || []).flatMap((group) => (group.items || []).map((item) => item.title))
  assert.ok(titles.includes('关于知鹿'), `关于知鹿 entry is missing from: ${titles.join(', ')}`)

  definition.handleItem.call({ data: {}, setData() {} }, { currentTarget: { dataset: { name: '关于知鹿' } } })
  assert.deepEqual(navigations, [{ url: '/account/about/index' }])

  const app = require('../app.json')
  const accountPages = app.subpackages.find((item) => item.root === 'account').pages
  assert.ok(accountPages.includes('about/index') && accountPages.includes('agreement/index'))

  const aboutPath = require.resolve('../account/about/index.js')
  delete require.cache[aboutPath]
  let about = null
  global.Page = (page) => { about = page }
  require(aboutPath)
  assert.equal(about.data.filingNumber, '粤ICP备2026107077号-6X')
  about.openUserAgreement.call({ data: about.data })
  assert.deepEqual(navigations.at(-1), { url: '/account/agreement/index' })
})

test('the me page shows the mini program version from WeChat at the very bottom', () => {
  const versionPath = require.resolve('../utils/mini-program-version.js')
  const versionText = (miniProgram) => {
    global.wx = { getAccountInfoSync: miniProgram && (() => ({ miniProgram })) }
    delete require.cache[versionPath]
    return require(versionPath).miniProgramVersionText()
  }
  assert.equal(versionText({ envVersion: 'release', version: '1.0.3' }), '版本 1.0.3')
  assert.equal(versionText({ envVersion: 'trial', version: '' }), '体验版')
  assert.equal(versionText({ envVersion: 'develop', version: '' }), '开发版')
  assert.equal(versionText({ envVersion: 'release', version: '' }), '')
  assert.equal(versionText(null), '')

  // 放在「我的」页内容的最后一行，关于知鹿页不再显示
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/me/index.wxml'), 'utf8')
  assert.match(wxml, /<view wx:if="\{\{versionText\}\}" class="me-version-row"><text class="me-version">\{\{versionText\}\}<\/text><\/view>\s*<\/view>\s*<\/view>\s*<\/scroll-view>/)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../account/about/index.wxml'), 'utf8'), /versionText/)
  const js = fs.readFileSync(path.join(__dirname, '../pages/me/index.js'), 'utf8')
  assert.match(js, /versionText: miniProgramVersionText\(\)/)
})

test('user agreement says refunds are not supported after 7 days', () => {
  const { USER_AGREEMENT } = require('../pages/login/user-agreement')
  const text = USER_AGREEMENT.sections.map((section) => section.paragraphs.join('')).join('')
  assert.match(text, /7 日内可以联系客服申请退款；超过 7 日的，不支持退款/)
})

test('user agreement allows exchanging coins for cash but not course points', () => {
  const { USER_AGREEMENT } = require('../pages/login/user-agreement')
  const text = USER_AGREEMENT.sections.map((section) => section.paragraphs.join('')).join('')
  assert.doesNotMatch(text, /不支持提现|课程积分和金币仅是/)
  assert.match(text, /金币[^。]*兑换成现金，转入你本人的微信零钱/)
  assert.match(text, /课程积分仅是本服务内的使用凭证，不具有货币价值，不能兑换现金/)
})
