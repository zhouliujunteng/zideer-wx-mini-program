// 2026-09-30 用户要求：没登录、不是会员时点会员课程，进「定制课程」介绍页；按访问状态给登录 / 完善资料 / 开通会员，
// 开通后回到本页直接进刚才点的课程。游客能打开这一页，不被带去登录。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const paymentSwitchStub = require('./helpers/payment-switch-stub')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const id = 'c'.repeat(32)

function loadIntro({ access = 'guest', courses = [] } = {}) {
  let definition
  const state = { access, courses, navigate: [], redirect: [], libraryReads: 0 }
  const wx = {
    navigateTo: (options) => state.navigate.push(options.url),
    redirectTo: (options) => state.redirect.push(options.url),
    switchTab() {},
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 50, height: 32 })
  }
  vm.runInNewContext(read('learning/custom-course-intro/index.js'), {
    Page(page) { definition = page }, wx, getCurrentPages: () => [{}, {}],
    require(name) {
      if (name.endsWith('/services/identity')) return {
        loadViewerAccess: async () => state.access,
        loadMemberCourseLibrary: async () => { state.libraryReads += 1; return state.courses }
      }
      if (name.endsWith('/services/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/services/payment-switch')) return paymentSwitchStub(wx)
      if (name.endsWith('/utils/access-gate')) return { openLogin: () => wx.navigateTo({ url: '/pages/login/login' }), openProfileSetup: () => wx.navigateTo({ url: '/pages/profile-setup/index' }) }
      return require(path.join(__dirname, '../learning/custom-course-intro', name))
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  return { page, state }
}

test('the intro page is registered and guests can browse it without being sent to login', () => {
  const app = JSON.parse(read('app.json'))
  assert.ok(app.subpackages.find((pkg) => pkg.root === 'learning').pages.includes('custom-course-intro/index'))
  assert.match(read('services/identity.js'), /'learning\/custom-course-intro\/index'\n\]/)
})

test('the bottom button follows the viewer: login, complete profile, join, then open the course', async () => {
  const { page, state } = loadIntro()
  page.onLoad({ libraryCourseId: id, title: encodeURIComponent('分数的  意义') })
  assert.equal(page.data.courseTitle, '分数的 意义')
  assert.equal(page.data.cta, '')

  await page.onShow()
  assert.equal(page.data.cta, 'guest')
  assert.equal(state.libraryReads, 0)
  page.handlePrimary()
  page.openServiceContact()

  state.access = 'profile'
  await page.onShow()
  assert.equal(page.data.cta, 'profile')
  page.handlePrimary()

  state.access = 'ready'
  state.courses = [{ id, title: '分数的意义', isMember: false }]
  await page.onShow()
  assert.equal(page.data.cta, 'join')
  page.handlePrimary()
  page.openServiceContact()

  state.courses = [{ id, title: '分数的意义', isMember: true }]
  await page.onShow()
  assert.equal(page.data.cta, 'member')
  page.handlePrimary()

  assert.deepEqual(state.navigate, ['/pages/login/login', '/pages/login/login', '/pages/profile-setup/index', '/commerce/membership/index', '/account/service-contact/index'])
  assert.deepEqual(state.redirect, [`/learning/course/index?libraryCourseId=${id}`])
})

test('an invalid course id shows no course card and never opens a course', async () => {
  const { page, state } = loadIntro({ access: 'ready', courses: [{ id, isMember: true }] })
  page.onLoad({ libraryCourseId: '../private', title: '课程' })
  await page.onShow()
  assert.deepEqual([page.data.courseTitle, page.data.cta, state.libraryReads], ['', 'join', 0])
  page.handlePrimary()
  assert.deepEqual(state.redirect, [])
})

test('before the viewer is known the button slot is a skeleton, not a guessed button', () => {
  const wxml = read('learning/custom-course-intro/index.wxml')
  assert.match(wxml, /<block wx:elif="\{\{cta\}\}">[\s\S]*<block wx:else>\s*<view class="sk custom-intro-secondary-sk">/)
})

// 2026-09-30 用户规则：支付开关关着时不给「开通会员」按钮和介绍，只留「咨询老师」
test('with the payment switch closed a non-member only gets the teacher contact', () => {
  const wxml = read('learning/custom-course-intro/index.wxml')
  assert.match(wxml, /<block wx:if="\{\{cta === 'join' && !paymentOpen\}\}">\s*<view class="custom-intro-primary" bindtap="openServiceContact"[^>]*>咨询老师<\/view>\s*<\/block>/)
  assert.match(wxml, /paymentOpen \? '开通会员后就能学' : '会员功能准备中，敬请期待'/)
})
