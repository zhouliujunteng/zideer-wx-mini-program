const { attachPaymentSwitch, knownPaymentOpen } = require('../../services/payment-switch')
const { hasSession, loadCurrentServiceContacts } = require('../../services/identity')
const { openCustomerServiceChat, customerServiceErrorMessage } = require('../../utils/customer-service')
const { openLogin } = require('../../utils/access-gate')
const { attachUiAssets } = require('../../services/ui-assets')
const { readAccountType } = require('../../utils/account-role')
const { rpxToPx } = require('../../utils/screen')
const content = require('./content')
const { searchEntries, highlight } = require('./search')

// 帮助与反馈（「我的 → 知鹿服务」最后一项）：搜索、操作指南、常见问题，以及去「问题反馈」的入口。
// 内容是本机固定的（./content.js），游客也能看；会员与付款相关条目跟着支付开关显示（开关关着时不出现）。
// 操作指南的分步图解在 account/help-guide。

// 顶部大图（help/hero.jpg）最上面这么高一段只有渐变底、没有元素
const HERO_EMPTY_TOP_RPX = 110

function guideCard(guide, query) {
  return {
    id: guide.id,
    title: guide.title,
    iconPath: content.guideIconPath(guide.id),
    tone: guide.tone,
    stepCount: guide.steps.length,
    titleParts: query ? highlight(guide.title, query) : null
  }
}

function faqItem(faq, query) {
  return {
    id: faq.id,
    title: faq.title,
    answer: faq.answer,
    guide: faq.guide || '',
    categoryName: content.categoryName(faq.category),
    titleParts: query ? highlight(faq.title, query) : null
  }
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    query: '',
    searchFocused: false,
    hotWords: content.HOT_WORDS,
    guides: [],
    categories: [],
    categoryId: 'all',
    faqList: [],
    openFaqId: '',
    guideResults: [],
    faqResults: [],
    resultCount: 0,
    // 往下滑之后顶栏换成浅色底
    topbarSolid: false,
    // 支付开关：开着才列会员与付款相关的问题与指南（services/payment-switch.js，没读到过按关着）
    paymentOpen: false,
    // 顶部大图加载完再淡入，之前显示同色渐变底
    heroLoaded: false,
    // 顶部大图往下挪多少（px）：图片上方约 110rpx 是空的渐变，挪到顶栏底边附近，元素就不会落进顶栏
    heroArtTop: 0
  },
  onLoad(options = {}) {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    const windowWidth = windowInfo.windowWidth || 375
    const contentTop = statusBarHeight + navigationBarHeight + rpxToPx(12, windowWidth)
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop,
      heroArtTop: Math.max(0, Math.round(contentTop - rpxToPx(HERO_EMPTY_TOP_RPX, windowWidth))),
      paymentOpen: knownPaymentOpen()
    })
    this.refreshContent()
    // 从别处带着关键词进来（如 ?q=打卡）直接显示搜索结果
    const query = options.q ? decodeURIComponent(String(options.q)) : ''
    if (query) this.applyQuery(query)
  },
  onShow() {
    this.loadEnterpriseContacts()
    const before = this.data.paymentOpen
    attachPaymentSwitch(this).then(() => {
      if (this.data.paymentOpen !== before) this.refreshContent()
    })
  },
  // 按支付开关、账号身份挑出能显示的指南和分类，再按当前分类、关键词重算列表
  refreshContent() {
    const scope = { paymentOpen: this.data.paymentOpen, accountType: readAccountType() }
    this._guides = content.visibleGuides(scope)
    this._faqs = content.visibleFaqs(scope)
    const categories = [{ id: 'all', name: '全部' }].concat(content.CATEGORIES.filter((category) => this._faqs.some((faq) => faq.category === category.id)))
    const categoryId = categories.some((category) => category.id === this.data.categoryId) ? this.data.categoryId : 'all'
    this.setData({ guides: this._guides.map((guide) => guideCard(guide)), categories, categoryId })
    this.updateFaqList(categoryId)
    if (this.data.query) this.applyQuery(this.data.query)
  },
  updateFaqList(categoryId) {
    const faqs = categoryId === 'all' ? this._faqs : this._faqs.filter((faq) => faq.category === categoryId)
    this.setData({ faqList: faqs.map((faq) => faqItem(faq)) })
  },
  applyQuery(value) {
    const query = String(value || '').slice(0, 40)
    const trimmed = query.trim()
    if (!trimmed) {
      this.setData({ query: '', guideResults: [], faqResults: [], resultCount: 0, openFaqId: '' })
      return
    }
    const guideResults = searchEntries(this._guides || [], trimmed).map((guide) => guideCard(guide, trimmed))
    const faqResults = searchEntries(this._faqs || [], trimmed).map((faq) => faqItem(faq, trimmed))
    // 只搜到一条问题时直接展开答案
    const openFaqId = faqResults.length === 1 && !guideResults.length ? faqResults[0].id : ''
    this.setData({ query, guideResults, faqResults, resultCount: guideResults.length + faqResults.length, openFaqId })
  },
  handleQueryInput(event) {
    this.applyQuery(event.detail.value)
  },
  handleQueryConfirm(event) {
    this.applyQuery(event.detail.value)
  },
  handleScroll(event) {
    const solid = event.detail.scrollTop > 24
    if (solid !== this.data.topbarSolid) this.setData({ topbarSolid: solid })
  },
  // 企业微信客服入口（与学习页「联系老师定制课程」同一个动作流）：游客不读，点了先登录
  async loadEnterpriseContacts() {
    const version = this._contactsVersion = (this._contactsVersion || 0) + 1
    if (!hasSession()) { this._contacts = []; return }
    try {
      const result = await loadCurrentServiceContacts()
      if (version === this._contactsVersion) this._contacts = result.status === 'ready' ? result.contacts : []
    } catch (error) {
      if (version === this._contactsVersion) this._contacts = []
    }
  },
  // 只有一个客服入口时直接打开企微会话；没有或有多个时进「真人服务」（那里会说明原因或让用户选）
  async openEnterpriseService() {
    if (this._serviceOpening) return
    if (!hasSession()) return openLogin()
    const contacts = this._contacts || []
    if (contacts.length !== 1) return wx.navigateTo({ url: '/account/service-contact/index' })
    this._serviceOpening = true
    try {
      await openCustomerServiceChat(contacts[0])
    } catch (error) {
      wx.showToast({ title: customerServiceErrorMessage(error), icon: 'none' })
    } finally {
      this._serviceOpening = false
    }
  },
  handleHeroLoad() { if (!this.data.heroLoaded) this.setData({ heroLoaded: true }) },
  handleSearchFocus() { this.setData({ searchFocused: true }) },
  handleSearchBlur() { this.setData({ searchFocused: false }) },
  clearQuery() { this.applyQuery('') },
  useHotWord(event) {
    this.applyQuery(String(event.currentTarget.dataset.word || ''))
  },
  selectCategory(event) {
    const categoryId = String(event.currentTarget.dataset.id || 'all')
    if (categoryId === this.data.categoryId) return
    this.setData({ categoryId, openFaqId: '' })
    this.updateFaqList(categoryId)
  },
  toggleFaq(event) {
    const id = String(event.currentTarget.dataset.id || '')
    this.setData({ openFaqId: this.data.openFaqId === id ? '' : id })
  },
  openGuide(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!content.findGuide(id)) return
    wx.navigateTo({ url: `/account/help-guide/index?id=${id}` })
  },
  openFeedback() {
    wx.navigateTo({ url: '/account/help-feedback/index' })
  },
  // 右上角「···」里的转发、复制链接：打开帮助与反馈；每份操作指南页另有自己的分享
  onShareAppMessage() {
    return { title: '帮助与反馈｜知鹿学习', path: '/account/help-center/index' }
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  }
})
