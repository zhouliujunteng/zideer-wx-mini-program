const { loadFamilyWechatQr, downloadFamilyWechatQr, uploadFamilyWechatQr } = require('../../services/identity')
const { rpxToPx } = require('../../utils/screen')

// 我的微信二维码（2026-11-11 用户规则）：开通会员付款前必须上传本人的微信加好友二维码，客服和导师妈妈用它加家长微信。
// 会员中心付款前发现没传会带 ?from=membership 打开本页，传完回去继续开通。图片存在课程服务（lib/family-wechat-qr），只给本人、客服、
// 接了单的导师妈妈看。
function dateText(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    uploaded: false,
    uploadedText: '',
    previewSrc: '',
    uploading: false,
    fromMembership: false
  },
  onLoad(options = {}) {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight, navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375),
      fromMembership: options.from === 'membership'
    })
    this.load()
  },
  async load() {
    try {
      const state = await loadFamilyWechatQr()
      this.setData({ loaded: true, loadFailed: false, uploaded: state.uploaded, uploadedText: dateText(state.uploadedAt) })
      if (state.uploaded && !this.data.previewSrc) {
        const previewSrc = await downloadFamilyWechatQr().catch(() => '')
        if (previewSrc) this.setData({ previewSrc: `${previewSrc}?t=${Date.now()}` })
      }
    } catch (error) {
      if (this.data.loaded) return wx.showToast({ title: error.message || '二维码状态读取失败', icon: 'none' })
      this.setData({ loadFailed: true, errorMessage: error.message || '微信二维码状态暂时读不到，请稍后重试。' })
    }
  },
  retry() { this.setData({ loadFailed: false }); this.load() },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  choose() {
    if (this.data.uploading) return
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (file && file.tempFilePath) this.upload(file.tempFilePath)
      }
    })
  },
  async upload(filePath) {
    this.setData({ uploading: true })
    try {
      const state = await uploadFamilyWechatQr(filePath)
      this.setData({ uploaded: true, uploadedText: dateText(state.uploadedAt), previewSrc: filePath })
      wx.showToast({ title: '已上传', icon: 'success' })
      if (this.data.fromMembership) setTimeout(() => this.handleBack(), 800)
    } catch (error) {
      wx.showToast({ title: error.message || '上传没有成功，请稍后重试。', icon: 'none', duration: 2600 })
    } finally {
      this.setData({ uploading: false })
    }
  },
  preview() {
    if (this.data.previewSrc) wx.previewImage({ urls: [this.data.previewSrc] })
  }
})
