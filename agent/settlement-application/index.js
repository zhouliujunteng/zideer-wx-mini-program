const { loadCurrentServiceContacts } = require('../../services/identity')
const { loadSettlementApplication } = require('../../services/settlement-service')
const { buildApplicationDetail } = require('../../services/settlement-apply-view')
const { attachUiAssets } = require('../../services/ui-assets')
const { openCustomerServiceChat, customerServiceErrorMessage } = require('../../utils/customer-service')

// 结算详情（2026-09-26，我的结算记录进入，界面照结算中心）：
// 提现：提交 → 平台处理 → 已打款 / 已驳回；打款后显示后台录入的核定佣金、代扣税费、实发金额与支付凭证。
// 兑换积分：提交即到账，显示兑换比例、到账积分与有效期。
// 发票与支付凭证是约两天有效的签名地址：图片直接预览，PDF 下载后用系统文档打开，不在本地保存地址。

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    isScrolled: false,
    topbarProgress: 0,
    topbarWhiteOpacity: 1,
    title: '结算详情',
    detail: {},
    serviceContact: null,
    serviceMeta: '',
    serviceOpening: false,
    openingFileId: ''
  },

  onLoad(options = {}) {
    attachUiAssets(this)
    this._id = String(options.id || '')
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { left: windowWidth - 92, top: (windowInfo.statusBarHeight || 20) + 6, width: 87, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18 })
  },

  onShow() {
    return this.loadPage()
  },

  async loadPage() {
    const requestId = (this._loadRequestId || 0) + 1
    this._loadRequestId = requestId
    if (this.data.loadState !== 'ready') this.setData({ loadState: 'loading', loadError: '' })
    try {
      const [detail, service] = await Promise.all([
        loadSettlementApplication(this._id),
        loadCurrentServiceContacts().catch(() => ({ status: 'failed', contacts: [] }))
      ])
      if (requestId !== this._loadRequestId) return
      const contact = (service && service.contacts || [])[0] || null
      this.setData({
        loadState: 'ready',
        detail: buildApplicationDetail(detail),
        serviceContact: contact,
        serviceMeta: contact ? `企业微信 · ${contact.title}` : '暂无可用入口，可去真人服务页查看'
      })
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: error.message || '结算详情刷新失败', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  handleScroll() {
    if (this._topbarQueryPending) return
    this._topbarQueryPending = true
    wx.createSelectorQuery()
      .select('.application-hero')
      .boundingClientRect((rect) => {
        this._topbarQueryPending = false
        if (!rect || !rect.height) return
        const topbarBottom = this.data.statusBarHeight + this.data.navigationBarHeight
        const progress = Math.min(1, Math.max(0, (topbarBottom - rect.top) / rect.height))
        const topbarProgress = Number(progress.toFixed(2))
        const isScrolled = progress >= 1
        if (topbarProgress !== this.data.topbarProgress || isScrolled !== this.data.isScrolled) {
          this.setData({ isScrolled, topbarProgress, topbarWhiteOpacity: Number((1 - progress).toFixed(2)) })
        }
      })
      .exec()
  },

  handleOpenFile(event) {
    const id = String(event.currentTarget.dataset.id || '')
    const group = String(event.currentTarget.dataset.group || '')
    const files = (this.data.detail[group] || [])
    const file = files.find((item) => item.id === id)
    if (!file || !file.url || this.data.openingFileId) return
    if (file.isImage) {
      wx.previewImage({ urls: files.filter((item) => item.isImage && item.url).map((item) => item.url), current: file.url })
      return
    }
    this.setData({ openingFileId: id })
    wx.downloadFile({
      url: file.url,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          wx.showToast({ title: '文件暂时打不开，请刷新后重试', icon: 'none' })
          return
        }
        wx.openDocument({ filePath: res.tempFilePath, fileType: 'pdf', showMenu: true, fail: () => wx.showToast({ title: '文件暂时打不开', icon: 'none' }) })
      },
      fail: () => wx.showToast({ title: '文件下载失败，请检查网络', icon: 'none' }),
      complete: () => this.setData({ openingFileId: '' })
    })
  },

  handleCopyNo() {
    const no = this.data.detail && this.data.detail.requestNo
    if (no) wx.setClipboardData({ data: no })
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.navigateTo({ url: '/agent/settlement-applications/index' })
  },

  async handleService() {
    if (this.data.serviceOpening) return
    const contact = this.data.serviceContact
    if (!contact) {
      wx.navigateTo({ url: '/account/service-contact/index' })
      return
    }
    this.setData({ serviceOpening: true })
    try {
      await openCustomerServiceChat(contact)
    } catch (error) {
      wx.showToast({ title: customerServiceErrorMessage(error), icon: 'none' })
    } finally {
      this.setData({ serviceOpening: false })
    }
  }
})
