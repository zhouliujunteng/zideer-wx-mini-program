const { loadCurrentGrowthCenter, loadPublishedPromotionAssets, loadCurrentPromotionPosterParts } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { rpxToPx, columnWidth } = require('../../utils/screen')
const { buildPosters, posterQrLayout, shareLinkPageUrl, inviteFriendCover } = require('../../services/promotion-view')
const { prepareShareCover, shareWithCover } = require('../../services/share-cover')
const { isTimelineSinglePage } = require('../../utils/timeline-single-page')

// 海报详情（M57）：界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 295f610
// 的 package-promotion/pages/poster-detail（2026-09-20 同步）。
// 与设计稿的差异（后端口径）：
// - 邀请码用推广伙伴档案里的真实 promotion_code，没有档案时不展示邀请码卡片。
// - 「立即推广」会向服务端申请一条 poster 场景的真实邀请，分享卡片走它的 token 路径完成归因；
//   申请失败时分享退回普通首页路径，不伪造归因。
// - 「分享说明 / 奖励说明」两段 mock 文案改为素材自带的真实推广文案，并支持复制。
// - 未开通推广伙伴也能看详情、保存与分享（2026-09-21 用户决定）：没有邀请码就不显示邀请码卡片，
//   邀请申请失败时分享退回普通首页路径，不伪造归因。
// - 保存海报真实落地：下载后端素材原图后存相册；小程序码仍是占位（服务端尚未合成）。

const SHEET_TRANSITION_MS = 420
const SHARE_SHEET_CLOSE_MS = 320
const PROMOTION_CODE_RESET_MS = 1800
const RATIO_MAP = { 'ratio-3-4': 3 / 4, 'ratio-9-16': 9 / 16, 'ratio-1-1': 1, 'ratio-16-9': 16 / 9 }

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    poster: {},
    promotionCode: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    viewportHeight: 667,
    windowWidth: 375,
    sheetTopPx: 439,
    sheetCollapsedTopPx: 439,
    sheetHeightPx: 250,
    sheetCollapsedHeight: 250,
    sheetExpandedHeight: 460,
    sheetExpanded: false,
    sheetTransition: false,
    posterPreviewStyle: '',
    skeletonPosterStyle: '',
    promotePosterStyle: '',
    showPromoteSheet: false,
    promoteSheetClosing: false,
    promotionCodeCopied: false,
    savingPoster: false,
    // 「立即推广」时后端把我的小程序码合成到海报右下角，返回合成图；没拿到就退回原图
    shareImageSrc: '',
    composingPoster: false,
    composeFailed: false
  },

  onLoad(options = {}) {
    attachUiAssets(this)
    // 朋友圈卡片和「复制链接」只能打开分享时的这一页，查询串里只有邀请参数、没有海报 id：
    // 点开的是被邀请的好友，不是来推广的人。朋友圈单页里放一张邀请说明，等好友点「前往小程序」；
    // 进了完整小程序就送回首页，推荐人线索已由 app.js 记下，首页在后台兑现。
    if (!options.id) {
      if (isTimelineSinglePage()) {
        this.setData({ loadState: 'timeline' })
        return
      }
      wx.reLaunch({ url: '/pages/home/index' })
      return
    }
    this._posterId = String(options.id || '')
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { left: windowWidth - 92, top: (windowInfo.statusBarHeight || 20) + 6, width: 87, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 10,
      viewportHeight: windowInfo.windowHeight || 667,
      windowWidth
    })
    // 首次读到海报前的骨架按默认 3:4 海报的预览尺寸画，读到后换成真实比例
    this.setData({
      skeletonPosterStyle: this.posterLayout('ratio-3-4', { contentTop: this.data.contentTop, posterGap: 20, sheetMinHeight: 228 }).style
    })
    if (wx.showShareMenu) wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'] })
    return this.loadPage()
  },

  async loadPage() {
    this.setData({ loadState: 'loading', loadError: '' })
    try {
      const [materials, growth] = await Promise.all([
        loadPublishedPromotionAssets(),
        loadCurrentGrowthCenter().catch(() => null)
      ])
      const posters = buildPosters(materials.assets)
      const poster = posters.find((item) => item.id === this._posterId)
      if (!poster) throw new Error('该海报已下架或不在可用范围内。')
      const promoter = growth && growth.promoter
      // 人人都有邀请码；这里只用已加载的档案兜个底，真实的码在「立即推广」合成时由后端下发
      const promotionCode = promoter ? String(promoter.promotion_code || '') : ''
      this.setData({
        loadState: 'ready',
        poster,
        promotionCode,
        ...this.layoutData(poster, promotionCode)
      })
      prepareShareCover(this, inviteFriendCover(promotionCode))
    } catch (error) {
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  // 预览图与分享弹层的海报尺寸按可用区域算，保持素材原始比例。
  layoutData(poster, promotionCode = this.data.promotionCode) {
    const { windowWidth, viewportHeight } = this.data
    const topbarBottom = this.data.statusBarHeight + this.data.navigationBarHeight
    const contentTop = this.data.contentTop
    const posterGap = 20
    const sheetMinHeight = 228
    const previewLayout = this.posterLayout(poster.ratioClass, { contentTop, posterGap, sheetMinHeight })
    const shareLayout = this.posterLayout(poster.ratioClass, {
      contentTop: topbarBottom + this.toPx(12),
      posterGap: this.toPx(12),
      sheetMinHeight: this.toPx(366),
      maxWidthScale: poster.ratioClass === 'ratio-16-9' ? .78 : .90
    })
    const sheetCollapsedTopPx = Math.round(contentTop + previewLayout.height + posterGap)
    const sheetCollapsedHeight = Math.max(sheetMinHeight, Math.round(viewportHeight - sheetCollapsedTopPx))
    const sheetExpandedHeight = Math.max(
      sheetCollapsedHeight,
      Math.min(Math.round(viewportHeight * .70), viewportHeight - topbarBottom - 16)
    )
    return {
      sheetTopPx: sheetCollapsedTopPx,
      sheetCollapsedTopPx,
      sheetHeightPx: sheetCollapsedHeight,
      sheetCollapsedHeight,
      sheetExpandedHeight,
      sheetExpanded: false,
      sheetTransition: false,
      posterPreviewStyle: previewLayout.style,
      promotePosterStyle: shareLayout.style,
      windowWidth
    }
  },

  toPx(rpxValue) {
    return rpxToPx(rpxValue, this.data.windowWidth)
  },

  posterLayout(ratioClass, metrics) {
    const { contentTop, posterGap, sheetMinHeight, maxWidthScale = 1 } = metrics
    const ratio = RATIO_MAP[ratioClass] || RATIO_MAP['ratio-3-4']
    const maxWidth = Math.max(1, (columnWidth(this.data.windowWidth) - this.toPx(72)) * maxWidthScale)
    const maxHeight = Math.max(1, this.data.viewportHeight - sheetMinHeight - contentTop - posterGap)
    let width = maxWidth
    let height = width / ratio
    if (height > maxHeight) {
      height = maxHeight
      width = height * ratio
    }
    const roundedWidth = Math.round(width)
    const roundedHeight = Math.round(height)
    return { width: roundedWidth, height: roundedHeight, style: `width: ${roundedWidth}px; height: ${roundedHeight}px;` }
  },

  // 封面真实宽高回来后重算一次布局，避免竖版海报按 3:4 显示。
  handlePosterLoad(event) {
    const detail = event.detail || {}
    const width = Number(detail.width)
    const height = Number(detail.height)
    if (!width || !height) return
    this._posterNaturalSize = { width, height }
    const ratio = width / height
    let matched = 'ratio-3-4'
    for (const name of Object.keys(RATIO_MAP)) {
      if (Math.abs(RATIO_MAP[name] - ratio) < Math.abs(RATIO_MAP[matched] - ratio)) matched = name
    }
    if (matched === this.data.poster.ratioClass) return
    const poster = { ...this.data.poster, ratioClass: matched }
    this.setData({ poster, ...this.layoutData(poster) })
  },

  toggleSheet() {
    if (this._sheetDidMove) {
      this._sheetDidMove = false
      return
    }
    this.setSheetExpanded(!this.data.sheetExpanded)
  },

  setSheetExpanded(expanded) {
    const nextExpanded = Boolean(expanded)
    this.setData({
      sheetExpanded: nextExpanded,
      sheetTransition: true,
      sheetHeightPx: nextExpanded ? this.data.sheetExpandedHeight : this.data.sheetCollapsedHeight,
      sheetTopPx: nextExpanded
        ? this.data.viewportHeight - this.data.sheetExpandedHeight
        : this.data.sheetCollapsedTopPx
    })
    if (this._sheetTransitionTimer) clearTimeout(this._sheetTransitionTimer)
    this._sheetTransitionTimer = setTimeout(() => {
      this._sheetTransitionTimer = null
      this.setData({ sheetTransition: false })
    }, SHEET_TRANSITION_MS)
  },

  handleSheetTouchStart(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._sheetTouchStartY = touch.clientY
    this._sheetTouchStartHeight = this.data.sheetHeightPx
    this._sheetDidMove = false
    if (this._sheetTransitionTimer) {
      clearTimeout(this._sheetTransitionTimer)
      this._sheetTransitionTimer = null
    }
    this.setData({ sheetTransition: false })
  },

  handleSheetTouchMove(e) {
    const touch = e.touches && e.touches[0]
    if (!touch || typeof this._sheetTouchStartY !== 'number') return
    const delta = this._sheetTouchStartY - touch.clientY
    if (Math.abs(delta) > 6) this._sheetDidMove = true
    const nextHeight = Math.max(
      this.data.sheetCollapsedHeight,
      Math.min(this.data.sheetExpandedHeight, this._sheetTouchStartHeight + delta)
    )
    this.setData({ sheetHeightPx: nextHeight, sheetTopPx: this.data.viewportHeight - nextHeight })
  },

  handleSheetTouchEnd() {
    if (typeof this._sheetTouchStartY !== 'number') return
    const didMove = this._sheetDidMove
    const midpoint = (this.data.sheetCollapsedHeight + this.data.sheetExpandedHeight) / 2
    const shouldExpand = this.data.sheetHeightPx >= midpoint
    this._sheetTouchStartY = null
    this._sheetTouchStartHeight = null
    this._sheetDidMove = false
    if (!didMove) return
    this.setSheetExpanded(shouldExpand)
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.redirectTo({ url: '/agent/promotion/index' })
  },

  // 「复制链接」要在小程序链接页里操作：那一页的地址带着邀请码，复制出来的链接才带得上邀请人
  handleOpenShareLink() {
    wx.navigateTo({ url: shareLinkPageUrl() })
  },

  handlePromoteAction() {
    this.setData({
      showPromoteSheet: true,
      promoteSheetClosing: false,
      shareImageSrc: this.data.shareImageSrc || this.data.poster.coverSrc || ''
    })
    return this.ensurePromotionPoster()
  },



  // 合成图＝海报 + 我的小程序码（圆形、透明底、画在右下角，占海报宽度 14%）。
  // 服务端不合成：微信小程序码最小只能出 280×280，贴到 1024 宽的海报上太大。
  // 同一次浏览只合成一次；失败不拦分享，退回原图并提示。
  async ensurePromotionPoster() {
    if (this._composedPosterSrc || this.data.composingPoster) return
    const posterId = Number(this.data.poster.id)
    if (!Number.isSafeInteger(posterId) || posterId <= 0) return
    this.setData({ composingPoster: true, composeFailed: false })
    try {
      const parts = await loadCurrentPromotionPosterParts(posterId)
      if (this.disposed) return
      const composed = await this.drawShareImage(parts)
      if (this.disposed) return
      this._composedPosterSrc = composed
      this.setData({
        shareImageSrc: composed,
        promotionCode: parts.promotionCode || this.data.promotionCode,
        composingPoster: false
      })
      // 拿到了邀请码：「邀请好友一起」卡片封面换成带码的那张
      prepareShareCover(this, inviteFriendCover(this.data.promotionCode))
    } catch (error) {
      if (this.disposed) return
      this.setData({ composingPoster: false, composeFailed: true })
    }
  },

  /** 把海报与小程序码画到离屏 canvas 上，返回本地临时图片路径。 */
  async drawShareImage({ posterUrl, qrUrl }) {
    const [posterPath, qrPath] = await Promise.all([this.downloadPoster(posterUrl), this.downloadPoster(qrUrl)])
    const canvas = await this.shareCanvas()
    const poster = await this.loadCanvasImage(canvas, posterPath)
    const qr = await this.loadCanvasImage(canvas, qrPath)
    const width = poster.width || 1024
    const height = poster.height || 1360
    const layout = posterQrLayout(width, height)
    if (!layout) throw new Error('海报尺寸异常')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(poster, 0, 0, width, height)
    // 先铺一个白色圆底（比码大一圈，留出扫码安静区），再把透明底的圆形码画在正中间
    ctx.save()
    ctx.beginPath()
    ctx.arc(layout.centerX, layout.centerY, layout.radius, 0, Math.PI * 2)
    ctx.closePath()
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()
    ctx.restore()
    ctx.drawImage(qr, layout.x, layout.y, layout.size, layout.size)
    return await this.exportCanvas(canvas, width, height)
  },

  shareCanvas() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#promote-canvas')
        .fields({ node: true, size: true })
        .exec((result) => {
          const node = result && result[0] && result[0].node
          if (node) resolve(node)
          else reject(new Error('画布不可用'))
        })
    })
  },

  loadCanvasImage(canvas, src) {
    return new Promise((resolve, reject) => {
      const image = canvas.createImage()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片加载失败'))
      image.src = src
    })
  },

  exportCanvas(canvas, width, height) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width,
        height,
        destWidth: width,
        destHeight: height,
        success: (result) => {
          if (result && result.tempFilePath) resolve(result.tempFilePath)
          else reject(new Error('推广图导出失败'))
        },
        fail: () => reject(new Error('推广图导出失败'))
      })
    })
  },

  handleClosePromoteSheet() {
    if (!this.data.showPromoteSheet || this.data.promoteSheetClosing) return
    this.setData({ promoteSheetClosing: true })
    if (this._promoteSheetTimer) clearTimeout(this._promoteSheetTimer)
    this._promoteSheetTimer = setTimeout(() => {
      this._promoteSheetTimer = null
      this.setData({ showPromoteSheet: false, promoteSheetClosing: false })
    }, SHARE_SHEET_CLOSE_MS)
  },

  handleCopyPromotionCode() {
    const code = String(this.data.promotionCode || '')
    if (!code) return
    wx.setClipboardData({
      data: code,
      success: () => {
        this.setData({ promotionCodeCopied: true })
        if (this._promotionCodeResetTimer) clearTimeout(this._promotionCodeResetTimer)
        this._promotionCodeResetTimer = setTimeout(() => {
          this._promotionCodeResetTimer = null
          this.setData({ promotionCodeCopied: false })
        }, PROMOTION_CODE_RESET_MS)
      }
    })
  },

  handleCopyText() {
    const text = String(this.data.poster.copyText || '')
    if (!text) {
      wx.showToast({ title: '该素材暂未提供文案。', icon: 'none' })
      return
    }
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '文案已复制', icon: 'success' }) })
  },

  // 保存的是后端素材原图（优先素材文件，其次封面），不做本地合成。
  async handleSavePoster() {
    if (this.data.savingPoster) return
    // 有合成图就存合成图（带我的小程序码），否则退回素材原图
    const source = this._composedPosterSrc || this.data.poster.fileSrc || this.data.poster.coverSrc
    if (!source) {
      wx.showToast({ title: '该素材暂无可保存的图片。', icon: 'none' })
      return
    }
    this.setData({ savingPoster: true })
    try {
      // 合成图已经是本地临时文件，网络素材才需要先下载
      const filePath = /^https?:/.test(source) ? await this.downloadPoster(source) : source
      await this.saveToAlbum(filePath)
      this.handleClosePromoteSheet()
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (error) {
      if (error && error.handled) return
      wx.showToast({ title: error && error.message || '海报保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ savingPoster: false })
    }
  },

  downloadPoster(url) {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url,
        success: (result) => {
          if (result.statusCode === 200 && result.tempFilePath) resolve(result.tempFilePath)
          else reject(new Error('海报下载失败，请重试'))
        },
        fail: () => reject(new Error('海报下载失败，请检查网络'))
      })
    })
  },

  saveToAlbum(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: resolve,
        fail: (error) => {
          const message = String(error && error.errMsg || '')
          if (/cancel/i.test(message)) {
            reject(Object.assign(new Error('已取消'), { handled: true }))
            return
          }
          // 取消不提示；没同意隐私指引、手机系统没给微信相册权限、设置里关了相册，各自说明（utils/permission-guide.js，2026-10-06）
          const { guideOnFailure } = require('../../utils/permission-guide')
          guideOnFailure(error, { scope: 'scope.writePhotosAlbum', content: '保存海报需要允许访问相册，请在设置里打开相册权限后再试。' })
            .then((kind) => { if (kind === 'other') wx.showToast({ title: '保存失败，请重试', icon: 'none' }) })
          reject(Object.assign(new Error('相册权限未开启'), { handled: true }))
        }
      })
    })
  },

  // 「邀请好友一起」与右上角转发：卡片封面是本页画的「好友邀请你 · 一起来知鹿学习」（services/promotion-view.js），
  // 不用海报原图——竖版海报被微信裁成 5:4 只剩上半截，网络图读不到时还会退回页面截图
  onShareAppMessage() {
    const poster = this.data.poster || {}
    const share = { title: poster.label || '知鹿学习', path: '/pages/home/index' }
    return shareWithCover(this, share, inviteFriendCover())
  },

  onShareTimeline() {
    const poster = this.data.poster || {}
    return { title: poster.label || '知鹿学习', query: this.shareQuery(), imageUrl: poster.coverSrc || '' }
  },

  // 朋友圈卡片与复制出去的链接不带海报 id（见 onLoad），2026-11-10 起也不带邀请码：好友点开直接进小程序。
  shareQuery() {
    return ''
  },

  // 右上角「复制链接」得到的 #小程序:// 链接打开当前页，查询串由这里给，与朋友圈卡片同一套。
  onShow() {
    this.stopCopyUrl()
    if (!wx.onCopyUrl) return
    this._copyUrlHandler = () => ({ query: this.shareQuery() })
    wx.onCopyUrl(this._copyUrlHandler)
  },

  onHide() {
    this.stopCopyUrl()
  },

  stopCopyUrl() {
    if (this._copyUrlHandler && wx.offCopyUrl) wx.offCopyUrl(this._copyUrlHandler)
    this._copyUrlHandler = null
  },

  noop() {},

  onUnload() {
    this.stopCopyUrl()
    if (this._sheetTransitionTimer) clearTimeout(this._sheetTransitionTimer)
    if (this._promoteSheetTimer) clearTimeout(this._promoteSheetTimer)
    if (this._promotionCodeResetTimer) clearTimeout(this._promotionCodeResetTimer)
  }
})
