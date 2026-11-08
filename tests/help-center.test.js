// 帮助与反馈（2026-10-04 用户要求）：「我的 → 知鹿服务」最后一项进帮助中心，里面能搜索常见问题、看带点击动画的操作指南，
// 再进问题反馈。内容是本机固定的，游客也能看；会员与付款相关的条目跟着支付开关，关着时不出现。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const paymentSwitchStub = require('./helpers/payment-switch-stub')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const content = require('../account/help-center/content')
const { searchEntries, highlight, queryTerms } = require('../account/help-center/search')
const app = require('../app.json')
const routes = new Set([...app.pages, ...app.subpackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`))])
const tabRoutes = new Set(app.tabBar.list.map((item) => `/${item.pagePath}`))

function loadPage(file, { paymentOpen = true, session = false, accountType = '', pages = 2, contacts = [] } = {}) {
  let definition
  const calls = { navigate: [], switchTab: [], redirect: [], back: 0, login: 0, copyUrl: [], chats: [], toasts: [] }
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 }),
    getStorageSync: (key) => (key === 'zhilu_account_type' ? accountType : ''),
    navigateTo: ({ url }) => calls.navigate.push(url),
    switchTab: ({ url }) => calls.switchTab.push(url),
    redirectTo: ({ url }) => calls.redirect.push(url),
    navigateBack: () => { calls.back += 1 },
    showToast: ({ title }) => calls.toasts.push(title),
    onCopyUrl: (handler) => calls.copyUrl.push(handler),
    offCopyUrl: (handler) => { calls.copyUrl = calls.copyUrl.filter((item) => item !== handler) }
  }
  vm.runInNewContext(read(file), {
    Page: (page) => { definition = page },
    getCurrentPages: () => new Array(pages).fill({}),
    setTimeout, clearTimeout,
    wx,
    require(name) {
      if (name.endsWith('/payment-switch')) return paymentSwitchStub(() => wx, { enabled: paymentOpen })
      if (name.endsWith('/services/identity')) return { hasSession: () => session, loadCurrentServiceContacts: async () => ({ status: contacts.length ? 'ready' : 'no_active_contacts', contacts }) }
      if (name.endsWith('/customer-service')) return { openCustomerServiceChat: async (contact) => { calls.chats.push(contact.id) }, customerServiceErrorMessage: () => '企微客服未打开，请稍后重试' }
      if (name.endsWith('/access-gate')) return { openLogin: () => { calls.login += 1 } }
      if (name.endsWith('/account-role')) return { readAccountType: () => accountType }
      if (name.endsWith('/utils/screen')) return { rpxToPx: (value) => value / 2, getMenuButtonRect: () => ({ left: 281, top: 50, width: 87, height: 32 }) }
      if (name.endsWith('/ui-assets')) return { attachUiAssets() {}, loadUiAssets: async () => ({}), getUiAssets: () => ({}) }
      if (name.endsWith('/services/share-cover')) return require('../services/share-cover')
      if (name.endsWith('/utils/share-cover')) return require('../utils/share-cover')
      if (name.endsWith('/content')) return content
      if (name.endsWith('/search')) return require('../account/help-center/search')
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  return { page, calls }
}

test('natural questions find the matching answer and highlight the hit words in the title', () => {
  const faqs = content.visibleFaqs({ paymentOpen: true })
  const guides = content.visibleGuides({ paymentOpen: true })
  assert.equal(searchEntries(faqs, '金币怎么提现')[0].id, 'coin-cash')
  assert.equal(searchEntries(guides, '金币怎么提现')[0].id, 'coin-cash')
  assert.equal(searchEntries(faqs, '绑定孩子')[0].id, 'bind-student')
  assert.equal(searchEntries(faqs, '怎么换学生身份')[0].id, 'switch-role')
  assert.equal(searchEntries(faqs, '课程打不开')[0].id, 'course-failed')
  assert.equal(searchEntries(faqs, 'iPad')[0].id, 'tablet-display')
  assert.equal(searchEntries(faqs, '我的订单')[0].id, 'orders')
  assert.equal(searchEntries(faqs, '冻结卡 怎么用')[0].id, 'streak-cards')
  assert.deepEqual(searchEntries(faqs, 'qwertyuiop'), [])
  assert.deepEqual(searchEntries(faqs, '   '), [])
  assert.deepEqual(queryTerms('请问金币怎么提现？'), ['金币', '提现'])
  assert.deepEqual(highlight('金币怎么兑换成现金？', '金币 现金'), [
    { text: '金币', hit: true }, { text: '怎么兑换成', hit: false }, { text: '现金', hit: true }, { text: '？', hit: false }
  ])
})

test('every question and guide is well formed: known categories, existing guides and real destinations', () => {
  const categoryIds = new Set(content.CATEGORIES.map((category) => category.id))
  const ids = new Set()
  for (const faq of content.FAQS) {
    assert.ok(!ids.has(faq.id), `duplicate faq ${faq.id}`); ids.add(faq.id)
    assert.ok(categoryIds.has(faq.category), `${faq.id} has unknown category ${faq.category}`)
    assert.ok(faq.title && faq.answer.length, `${faq.id} needs a title and an answer`)
    if (faq.guide) assert.ok(content.findGuide(faq.guide), `${faq.id} points at missing guide ${faq.guide}`)
  }
  const blockTypes = new Set(['profile', 'tiles', 'grid', 'menu', 'chips', 'list', 'card', 'input', 'code', 'pair', 'button', 'note', 'lines'])
  for (const guide of content.GUIDES) {
    const { action } = guide
    assert.ok(action && action.label, `${guide.id} needs an action`)
    if (action.tab) assert.ok(tabRoutes.has(action.tab), `${guide.id} switches to a non-tab page ${action.tab}`)
    else assert.ok(routes.has(action.url.replace(/^\//, '').split('?')[0]), `${guide.id} opens an unregistered page ${action.url}`)
    assert.ok(guide.steps.length >= 2, `${guide.id} needs steps`)
    for (const step of guide.steps) {
      const { figure } = step
      assert.ok(step.title && figure && figure.screen, `${guide.id} step "${step.title}" needs a figure`)
      for (const block of figure.blocks) assert.ok(blockTypes.has(block.type), `${guide.id} uses unknown block ${block.type}`)
      // 每一步都要有一个要点的位置，示意屏上才有点击动画
      const hot = figure.hotTab || figure.flameHot || figure.capsuleHot || (figure.modal && figure.modal.hot) ||
        figure.blocks.some((block) => block.hot || (block.items || []).some((item) => item.hot))
      assert.ok(hot, `${guide.id} step "${step.title}" has nothing to tap`)
    }
  }
  // 对外品牌名写「知鹿学习」；重置测试账号的开启码不能出现在帮助里
  const text = JSON.stringify([content.FAQS, content.GUIDES])
  assert.doesNotMatch(text, /知鹿私课|重置测试账号|123456as/i)
})

test('with the payment switch off, membership and payment help disappears and answers stop mentioning purchases', () => {
  const closed = content.visibleFaqs({ paymentOpen: false })
  assert.ok(!closed.some((faq) => faq.category === 'payment' || faq.payment))
  assert.ok(!content.visibleGuides({ paymentOpen: false }).some((guide) => guide.id === 'membership'))
  assert.doesNotMatch(JSON.stringify(closed), /积分包|开通会员|会员中心/)
  assert.ok(content.visibleFaqs({ paymentOpen: true }).some((faq) => faq.id === 'refund'))
})

test('the help center lists guides and questions, filters by category and searches as you type', async () => {
  const { page, calls } = loadPage('account/help-center/index.js', { paymentOpen: false })
  page.onLoad({})
  await page.onShow()
  assert.ok(page.data.guides.length >= 8)
  assert.ok(!page.data.guides.some((guide) => guide.id === 'membership'))
  assert.ok(!page.data.categories.some((category) => category.id === 'payment'))
  assert.equal(page.data.faqList.length, content.visibleFaqs({ paymentOpen: false }).length)

  page.selectCategory({ currentTarget: { dataset: { id: 'family' } } })
  assert.ok(page.data.faqList.length && page.data.faqList.every((faq) => faq.categoryName === '家长'))
  page.toggleFaq({ currentTarget: { dataset: { id: 'bind-student' } } })
  assert.equal(page.data.openFaqId, 'bind-student')
  page.toggleFaq({ currentTarget: { dataset: { id: 'bind-student' } } })
  assert.equal(page.data.openFaqId, '')

  page.handleQueryInput({ detail: { value: '金币怎么提现' } })
  assert.equal(page.data.faqResults[0].id, 'coin-cash')
  assert.equal(page.data.guideResults[0].id, 'coin-cash')
  assert.ok(page.data.faqResults[0].titleParts.some((part) => part.hit))
  page.handleQueryInput({ detail: { value: '退款' } })
  assert.equal(page.data.resultCount, 0, 'payment answers stay hidden from search while payment is off')
  page.handleQueryInput({ detail: { value: '没声音' } })
  assert.equal(page.data.openFaqId, 'no-sound', 'a single matching question opens right away')
  page.clearQuery()
  assert.equal(page.data.query, '')
  assert.equal(page.data.resultCount, 0)

  page.useHotWord({ currentTarget: { dataset: { word: '兑换码' } } })
  assert.equal(page.data.query, '兑换码')
  page.openGuide({ currentTarget: { dataset: { id: 'redeem-code' } } })
  page.openGuide({ currentTarget: { dataset: { id: 'no-such-guide' } } })
  page.openFeedback()
  assert.deepEqual([...calls.navigate], ['/account/help-guide/index?id=redeem-code', '/account/help-feedback/index'])
  // 游客点企业微信客服先去登录
  await page.openEnterpriseService()
  assert.equal(calls.login, 1)
})

test('payment help shows up once the switch is open, and a keyword in the link opens search results', async () => {
  const { page } = loadPage('account/help-center/index.js', { paymentOpen: true })
  page.onLoad({ q: encodeURIComponent('退款') })
  assert.equal(page.data.faqResults[0].id, 'refund')
  assert.ok(page.data.categories.some((category) => category.id === 'payment'))
  assert.ok(page.data.guides.some((guide) => guide.id === 'membership'))
})

test('a guide page draws each step, hides the map tab for parents and sends the user where to do it', async () => {
  const { page, calls } = loadPage('account/help-guide/index.js', { accountType: 'guardian' })
  page.onLoad({ id: 'redeem-code' })
  await page.onShow()
  const { guide } = page.data
  assert.equal(guide.title, '使用兑换码')
  const tabs = guide.steps[0].figure.tabItems
  // 页面在 vm 里跑，数组来自另一个 realm：转成本侧数组再比
  assert.deepEqual(Array.from(tabs, (tab) => tab.label), ['首页', '学习', '宇宙', '我的'])
  assert.deepEqual(Array.from(tabs).filter((tab) => tab.hot).map((tab) => tab.label), ['我的'])
  assert.ok(page.data.relatedFaqs.some((faq) => faq.id === 'redeem-code'))
  page.startAction()
  assert.deepEqual(calls.switchTab, ['/pages/me/index'])

  const student = loadPage('account/help-guide/index.js', { accountType: 'student' })
  student.page.onLoad({ id: 'start-course' })
  assert.equal(student.page.data.guide.steps[0].figure.tabItems.length, 5)

  const feedback = loadPage('account/help-guide/index.js')
  feedback.page.onLoad({ id: 'feedback' })
  feedback.page.startAction()
  assert.deepEqual(feedback.calls.navigate, ['/account/help-feedback/index'])
})

test('a guide that is unknown or hidden by the payment switch shows the missing state', async () => {
  const { page, calls } = loadPage('account/help-guide/index.js', { paymentOpen: false, pages: 1 })
  page.onLoad({ id: 'membership' })
  await page.onShow()
  assert.equal(page.data.guide, null)
  page.openHelpCenter()
  assert.deepEqual(calls.redirect, ['/account/help-center/index'])
  assert.match(read('account/help-guide/index.wxml'), /wx:if="\{\{!guide\}\}" class="hg-missing"/)
})

test('帮助与反馈 is the last item of 知鹿服务, open to guests, and opens the help center', () => {
  const { meModel } = require('../data/mock/tab-data.js')
  const service = meModel.serviceGroups.find((group) => group.title === '知鹿服务')
  assert.equal(service.items[service.items.length - 1].title, '帮助与反馈')
  assert.match(read('pages/me/index.js'), /'帮助与反馈': '\/account\/help-center\/index'/)
  assert.ok(routes.has('account/help-center/index') && routes.has('account/help-guide/index'))
  const identity = read('services/identity.js')
  assert.match(identity, /'account\/help-center\/index'/)
  assert.match(identity, /'account\/help-guide\/index'/)
  // 示意屏的点按动画：橙色描边 + 波纹 + 手指落点
  const css = read('account/help-guide/index.wxss')
  for (const name of ['hg-press', 'hg-ring', 'hg-finger']) assert.match(css, new RegExp(`@keyframes ${name} `))
})

test('each guide can be shared as a mini program card that opens that guide, with its own drawn cover', async () => {
  const { page, calls } = loadPage('account/help-guide/index.js')
  page.onLoad({ id: 'coin-cash' })
  // 胶囊在 left 281、宽 87：分享钮贴在胶囊左边 8px，复制链接的提示指向「···」
  assert.equal(page.data.shareButtonRight, 375 - 281 + 8)
  assert.equal(page.data.pointerLeft, Math.round(281 + 87 / 4))

  const pending = page.onShareAppMessage()
  assert.equal(pending.title, '金币兑换现金｜知鹿学习操作指南')
  assert.equal(pending.path, '/account/help-guide/index?id=coin-cash')
  assert.equal(typeof pending.promise.then, 'function', 'the cover is handed over through the share promise while it is drawn')
  assert.deepEqual({ ...(await pending.promise) }, { title: pending.title, path: pending.path })

  page.setData({ coverPath: 'wxfile://cover.png' })
  assert.deepEqual({ ...page.onShareAppMessage() }, { title: pending.title, path: pending.path, imageUrl: 'wxfile://cover.png' })

  page.openShare()
  assert.equal(page.data.shareVisible, true)
  page.showCopyHint()
  assert.equal(page.data.shareVisible, false)
  assert.equal(page.data.copyHintVisible, true)
  assert.equal(calls.copyUrl.length, 1)
  assert.deepEqual({ ...calls.copyUrl[0]() }, { query: 'id=coin-cash' })
  page.hideCopyHint()
  assert.equal(page.data.copyHintVisible, false)
  assert.equal(calls.copyUrl.length, 0)

  const center = loadPage('account/help-center/index.js')
  assert.deepEqual({ ...center.page.onShareAppMessage() }, { title: '帮助与反馈｜知鹿学习', path: '/account/help-center/index' })
  const wxml = read('account/help-guide/index.wxml')
  assert.match(wxml, /<button class="hg-share-native-button" open-type="share"/)
  assert.match(wxml, /<canvas type="2d" id="share-cover-canvas" class="share-cover-canvas"/)
})

test('the share cover is the generated background with the real logo, the guide icon and the title centred, and no phone', () => {
  const { drawGuideCover, wrapText } = require('../utils/share-cover')
  const calls = []
  const noop = () => {}
  const ctx = new Proxy({
    measureText: (text) => ({ width: String(text).length * 36 }),
    fillText: (text, x) => calls.push(['text', text, x]),
    drawImage: (image, x, y, width, height) => calls.push(['image', image.name, x, y, width, height]),
    createLinearGradient: () => ({ addColorStop: noop })
  }, { get: (target, key) => (key in target ? target[key] : noop), set: () => true })
  const images = { background: { name: 'bg' }, logo: { name: 'logo', width: 480, height: 190 }, icon: { name: 'icon' } }
  drawGuideCover(ctx, content.findGuide('bind-student'), images)
  assert.deepEqual(calls.filter((call) => call[0] === 'image').map((call) => call[1]), ['bg', 'logo', 'icon'])
  assert.deepEqual(calls.find((call) => call[1] === 'bg').slice(2), [0, 0, 500, 400])
  const logo = calls.find((call) => call[1] === 'logo')
  assert.equal(logo[2] + logo[4] / 2, 250, 'the logo sits in the middle')
  assert.equal(Math.round(logo[4] / logo[5] * 10), 25, 'the logo keeps its own aspect ratio')
  const texts = calls.filter((call) => call[0] === 'text')
  assert.deepEqual(texts.map((call) => call[1]), ['家长绑定孩子', '操作指南 · 共 5 步'])
  assert.ok(texts.every((call) => call[2] === 250), 'all text is centred')

  // 哪张图没读到就不画哪张：不拿文字或别的图形冒充 Logo
  calls.length = 0
  drawGuideCover(ctx, content.findGuide('bind-student'), { background: null, logo: null, icon: null })
  assert.deepEqual(calls.filter((call) => call[0] === 'image'), [])
  assert.deepEqual(calls.filter((call) => call[0] === 'text').map((call) => call[1]), ['家长绑定孩子', '操作指南 · 共 5 步'])
  assert.deepEqual(wrapText(ctx, '一二三四五六七八九十', 108, 2), ['一二三', '四五…'])
  assert.doesNotMatch(read('utils/share-cover.js'), /drawPhone|手机示意/)
})

test('guide cards, search rows and the guide header use the generated illustrations, and the cards no longer pulse', () => {
  const wxml = read('account/help-center/index.wxml')
  assert.match(wxml, /class="hc-guide-art" src="\{\{UA\.src\(ui, item\.iconPath\)\}\}"/)
  assert.match(wxml, /class="hc-hero-art [^"]*" src="\{\{UA\.src\(ui, '\/assets\/help\/hero\.jpg'\)\}\}"/)
  assert.doesNotMatch(wxml, /hc-guide-icon-tap/)
  assert.doesNotMatch(read('account/help-center/index.wxss'), /hc-ripple|hc-guide-icon-tap/)
  assert.match(read('account/help-guide/index.wxml'), /class="hg-hero-art" src="\{\{UA\.src\(ui, guide\.iconPath\)\}\}"/)
  assert.match(read('account/help-guide/index.wxml'), /class="hg-share-card-logo" src="\{\{UA\.src\(ui, '\/assets\/brand\/app-icon\.png'\)\}\}"/)
  for (const guide of content.GUIDES) assert.equal(content.guideIconPath(guide.id), `/assets/help/guide-${guide.id}.png`)
  const verify = read('scripts/verify-ui-assets.mjs')
  assert.match(verify, /help\/guide-\$\{id\}\.png/)
  assert.match(verify, /'help\/share-cover\.jpg'/)
  const upload = read('../scripts/ui-assets/upload-help-center-assets.mjs')
  for (const guide of content.GUIDES) assert.ok(upload.includes(`['${guide.id}',`), `upload script misses ${guide.id}`)
})

test('the bottom contact is WeCom customer service, not a phone number, and the top bar turns solid once scrolled', async () => {
  const one = loadPage('account/help-center/index.js', { session: true, contacts: [{ id: 'kf-1', corpId: 'ww0123456789abcdef', targetRef: 'https://work.weixin.qq.com/kfid/kfc1' }] })
  one.page.onLoad({})
  one.page.onShow()
  await one.page.loadEnterpriseContacts()
  await one.page.openEnterpriseService()
  assert.deepEqual([...one.calls.chats], ['kf-1'], 'a single contact opens the WeCom chat directly')

  const none = loadPage('account/help-center/index.js', { session: true })
  none.page.onLoad({})
  await none.page.loadEnterpriseContacts()
  await none.page.openEnterpriseService()
  assert.deepEqual([...none.calls.navigate], ['/account/service-contact/index'], 'no or several contacts go to 真人服务')

  const wxml = read('account/help-center/index.wxml')
  assert.match(wxml, /企业微信客服/)
  assert.doesNotMatch(wxml + read('account/help-center/index.js') + JSON.stringify(content.FAQS) + JSON.stringify(content.GUIDES), /客服电话|18118779283|makePhoneCall/)

  for (const file of ['account/help-center/index.js', 'account/help-guide/index.js']) {
    const { page } = loadPage(file)
    page.onLoad({ id: 'checkin' })
    page.handleScroll({ detail: { scrollTop: 200 } })
    assert.equal(page.data.topbarSolid, true, file)
    page.handleScroll({ detail: { scrollTop: 0 } })
    assert.equal(page.data.topbarSolid, false, file)
  }
  assert.match(read('account/help-center/index.wxml'), /class="hc-topbar \{\{topbarSolid \? 'is-solid' : ''\}\}"/)
  assert.match(read('account/help-guide/index.wxml'), /class="hg-topbar \{\{topbarSolid \? 'is-solid' : ''\}\}"/)
  // 大图按原图比例固定尺寸（1472×1140 → 750×581rpx），不跟着内容高度拉伸裁掉两侧
  assert.match(read('account/help-center/index.wxss'), /\.hc-hero-art \{[^}]*width: 750rpx; height: 581rpx;/)
})

test('the hero art moves down by the top bar height so its upper elements never sit under the back button or the capsule', () => {
  const { page } = loadPage('account/help-center/index.js')
  page.onLoad({})
  // 替身里 rpxToPx = 值 / 2：顶栏底边 contentTop 94px，图片最上面 110rpx（55px）是空的 → 往下挪 39px
  assert.equal(page.data.contentTop, 94)
  assert.equal(page.data.heroArtTop, 39)
  const wxml = read('account/help-center/index.wxml')
  assert.match(wxml, /class="hc-hero-art-wrap" style="top: \{\{heroArtTop\}\}px;"/)
  assert.match(wxml, /class="hc-hero-cap" style="height: \{\{heroArtTop \+ 1\}\}px;"/)
  assert.match(read('account/help-center/index.wxss'), /\.hc-hero-cap \{[^}]*background: #FECFA1;/)
})
