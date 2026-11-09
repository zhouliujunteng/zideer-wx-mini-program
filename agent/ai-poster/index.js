const {
  loadAiPosterCatalog, startAiPoster, loadAiPoster, POSTER_TEMPLATES: TEMPLATES, decoratePoster, filterActivities
} = require('../../services/ai-poster')
const { loadCurrentPromotionCode } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { posterQrLayout, shareLinkPageUrl } = require('../../services/promotion-view')
const { rpxToPx, columnWidth } = require('../../utils/screen')

// AI 海报生成（M56）：界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 847c572
// 的 package-promotion/pages/ai-poster（2026-09-26 同步）。设计稿是本地演示，这里接真实服务：
// - 活动清单、每日次数、海报历史来自课程服务 /api/learn/promotion-poster（运营在管理端「AI 海报活动」维护活动）。
// - 「生成专属海报」提交后服务端在后台出图（约 1 分钟），本页轮询；设计稿没有生成过程，这里补了生成中与失败两种状态。
// - 出图完成自动进入完成页并拉起分享层（与设计稿一致）；分享层把本人小程序码合成到海报右下角留白处，保存到相册。
// - 分享层只留「保存海报」：与海报详情一致（2026-09-22 用户决定去掉「分享给好友」；朋友圈也不能由代码发起）。
// - 所有登录用户都能用（推广海报对所有人开放，2026-09-21）。

const TEMPLATE_RATIOS = { portrait: 3 / 4, story: 9 / 16, square: 1 }
const POLL_INTERVAL_MS = 4000
// 服务端单张最多等 4 分钟，再留点余量；超过就停止轮询，提示去历史里看
const POLL_LIMIT_MS = 6 * 60 * 1000
const SIZE_CLOSE_MS = 260
const SHARE_CLOSE_MS = 280
const FAILURE_TOASTS = {
  content: '画面没通过内容审核，换个活动再试试',
  timeout: '这次生成时间太长了，请重新生成',
  interrupted: '生成被中断了，请重新生成'
}

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    windowWidth: 375,
    viewportHeight: 667,
    safeBottom: 0,
    activityMediaHeight: 220,
    historyTop: 26,
    historyRight: 12,
    historyButtonSize: 32,
    posterEnabled: true,
    activities: [],
    visibleActivities: [],
    activitySearch: '',
    selectedActivityId: '',
    templates: TEMPLATES,
    selectedTemplate: TEMPLATES[0],
    quota: { dailyLimit: 0, remaining: 0 },
    history: [],
    canGenerate: false,
    generateLabel: '生成专属海报',
    startingPoster: false,
    historyVisible: false,
    sizeVisible: false,
    sizeClosing: false,
    resultVisible: false,
    result: {},
    currentPosterId: '',
    resultPosterStyle: '',
    sharePosterStyle: '',
    shareVisible: false,
    shareClosing: false,
    shareImageSrc: '',
    composingPoster: false,
    composeFailed: false,
    savingPoster: false
  },

  onLoad() {
    attachUiAssets(this)
    this._composed = {}
    this._localFiles = []
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const statusBarHeight = Number.isFinite(windowInfo.statusBarHeight) ? windowInfo.statusBarHeight : 20
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { left: windowWidth - 92, top: statusBarHeight + 6, width: 87, height: 32 }
    const menuTop = Number.isFinite(menuButton.top) ? menuButton.top : statusBarHeight + 6
    const menuHeight = Number.isFinite(menuButton.height) ? menuButton.height : 32
    const menuLeft = Number.isFinite(menuButton.left) ? menuButton.left : windowWidth - 92
    const navigationBarHeight = menuHeight + (menuTop - statusBarHeight) * 2
    // 底部安全区（有 Home 指示条的机型约 34px），分享层海报要让开它和分享面板
    const safeArea = windowInfo.safeArea
    const safeBottom = safeArea && windowInfo.screenHeight ? Math.max(0, windowInfo.screenHeight - safeArea.bottom) : 0
    // 活动卡两列：内容区左右各 32rpx、列间距 20rpx，图片按 3:4
    const mediaWidth = rpxToPx((750 - 64 - 20) / 2, windowWidth)
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 18,
      windowWidth,
      viewportHeight: windowInfo.windowHeight || 667,
      safeBottom,
      activityMediaHeight: Math.round(mediaWidth * 4 / 3),
      // 胶囊位置只在这里读一次（转屏时读到的可能是旧值），按钮贴在胶囊左边
      historyTop: menuTop,
      historyRight: windowWidth - menuLeft + 8,
      historyButtonSize: menuHeight
    })
    this.refreshGenerateState()
    return this.loadCatalog()
  },

  onShow() {
    this._hidden = false
    if (this._loadedOnce) this.loadCatalog({ silent: true })
    const result = this.data.result
    if (this.data.resultVisible && result && result.status === 'generating') this.startPolling(result.id)
  },

  onHide() {
    this._hidden = true
    this.stopPolling()
  },

  onUnload() {
    this._hidden = true
    this.stopPolling()
    clearTimeout(this._sizeCloseTimer)
    clearTimeout(this._shareCloseTimer)
    // 本页暂存的海报文件用完即删，不占用户空间
    const fs = wx.getFileSystemManager && wx.getFileSystemManager()
    for (const filePath of this._localFiles || []) {
      if (fs) fs.unlink({ filePath, fail() {} })
    }
  },

  async loadCatalog({ silent = false } = {}) {
    const requestId = (this._catalogRequestId || 0) + 1
    this._catalogRequestId = requestId
    if (!silent && !this._loadedOnce) this.setData({ loadState: 'loading', loadError: '' })
    try {
      const catalog = await loadAiPosterCatalog()
      if (requestId !== this._catalogRequestId) return
      this._loadedOnce = true
      this.applyCatalog(catalog)
    } catch (error) {
      if (requestId !== this._catalogRequestId) return
      if (this._loadedOnce) {
        if (!silent) wx.showToast({ title: error.message || '刷新失败，请稍后重试', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
      this.refreshGenerateState()
    }
  },

  applyCatalog(catalog) {
    const templates = catalog.templates.length ? catalog.templates : TEMPLATES
    const activities = catalog.activities
    const keepActivity = activities.some((item) => item.id === this.data.selectedActivityId)
    const selectedActivityId = keepActivity ? this.data.selectedActivityId : (activities[0] ? activities[0].id : '')
    const selectedTemplate = templates.find((item) => item.id === this.data.selectedTemplate.id) || templates[0]
    const history = catalog.history.map((item) => decoratePoster(item, templates))
    const next = {
      loadState: 'ready',
      loadError: '',
      posterEnabled: catalog.enabled,
      activities,
      visibleActivities: filterActivities(activities, this.data.activitySearch),
      selectedActivityId,
      templates,
      selectedTemplate,
      quota: catalog.quota,
      history
    }
    // 完成页开着时，用最新记录更新它（后台可能已经出好图）
    const current = this.data.resultVisible && history.find((item) => item.id === this.data.currentPosterId)
    this.setData(next)
    if (current) this.updateResult(current)
    this.refreshGenerateState()
  },

  refreshGenerateState() {
    const { loadState, posterEnabled, selectedActivityId, startingPoster, quota } = this.data
    const ready = loadState === 'ready' && posterEnabled && Boolean(selectedActivityId)
    const exhausted = loadState === 'ready' && quota.remaining <= 0
    let generateLabel = '生成专属海报'
    if (startingPoster) generateLabel = '正在提交…'
    else if (ready && exhausted) generateLabel = '今日生成次数已用完'
    this.setData({ canGenerate: ready && !exhausted && !startingPoster, generateLabel })
  },

  handleBack() {
    if (this.data.shareVisible) {
      this.closeShare()
      return
    }
    if (this.data.resultVisible) {
      // 回到设置页；还在生成的海报在后台继续，稍后在「海报历史」里能看到
      this.stopPolling()
      this.setData({ resultVisible: false, shareVisible: false, currentPosterId: '' })
      return
    }
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.redirectTo({ url: '/agent/promotion/index' })
  },

  handleActivitySearch(e) {
    const activitySearch = e.detail.value || ''
    this.setData({ activitySearch, visibleActivities: filterActivities(this.data.activities, activitySearch) })
  },

  handleActivityPick(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id || id === this.data.selectedActivityId) return
    this.setData({ selectedActivityId: id })
    this.refreshGenerateState()
  },

  openSizeSelector() {
    clearTimeout(this._sizeCloseTimer)
    this._sizeCloseTimer = null
    this.setData({ sizeVisible: true, sizeClosing: false })
  },

  closeSizeSelector() {
    if (!this.data.sizeVisible || this.data.sizeClosing) return
    this.setData({ sizeClosing: true })
    this._sizeCloseTimer = setTimeout(() => {
      this._sizeCloseTimer = null
      this.setData({ sizeVisible: false, sizeClosing: false })
    }, SIZE_CLOSE_MS)
  },

  handleTemplatePick(e) {
    const template = this.data.templates.find((item) => item.id === e.currentTarget.dataset.id)
    if (template) this.setData({ selectedTemplate: template })
    this.closeSizeSelector()
  },

  handleGenerate() {
    if (this.data.startingPoster) return
    if (!this.data.canGenerate) {
      if (this.data.loadState === 'ready' && this.data.posterEnabled && this.data.quota.remaining <= 0) {
        wx.showToast({ title: '今天的生成次数用完了，明天再来吧', icon: 'none' })
      }
      return
    }
    return this.generate(this.data.selectedActivityId, this.data.selectedTemplate.id)
  },

  // 完成页「重新生成」：沿用这张海报的活动和尺寸（活动已下线时提示换一个）
  handleRegenerate() {
    const result = this.data.result || {}
    if (!this.data.activities.some((item) => item.id === result.activityId)) {
      wx.showToast({ title: '这个推广活动已下线，请换一个活动', icon: 'none' })
      return
    }
    const template = this.data.templates.find((item) => item.id === result.templateId)
    this.setData({ selectedActivityId: result.activityId, ...(template ? { selectedTemplate: template } : {}) })
    return this.generate(result.activityId, result.templateId)
  },

  async generate(activityId, templateId) {
    if (this.data.startingPoster) return
    this.setData({ startingPoster: true })
    this.refreshGenerateState()
    try {
      const { poster, remaining } = await startAiPoster(activityId, templateId)
      const decorated = decoratePoster(poster, this.data.templates)
      this.setData({
        history: [decorated, ...this.data.history.filter((item) => item.id !== decorated.id)],
        quota: { ...this.data.quota, remaining }
      })
      this.showResult(decorated)
    } catch (error) {
      wx.showToast({ title: error.message || '海报生成失败，请稍后重试', icon: 'none' })
      // 名额或在途状态以服务端为准
      if (['DAILY_LIMIT', 'GENERATION_IN_PROGRESS', 'ACTIVITY_NOT_FOUND', 'POSTER_DISABLED'].includes(error.code)) {
        this.loadCatalog({ silent: true })
      }
    } finally {
      this.setData({ startingPoster: false })
      this.refreshGenerateState()
    }
  },

  // 预览尺寸按可用区域算：完成页在顶栏下方靠上，分享层里居中（设计稿 847c572）
  posterDisplayStyle(poster, isShare = false) {
    const { windowWidth, viewportHeight, statusBarHeight, navigationBarHeight, safeBottom } = this.data
    const rpx = (value) => rpxToPx(value, windowWidth)
    const ratio = poster.width && poster.height
      ? poster.width / poster.height
      : TEMPLATE_RATIOS[poster.templateId] || TEMPLATE_RATIOS.portrait
    const topInset = statusBarHeight + navigationBarHeight + rpx(isShare ? 42 : 28)
    const bottomInset = isShare ? rpx(420) + safeBottom : rpx(150) + 16
    const maxWidth = columnWidth(windowWidth) - rpx(isShare ? 56 : 72)
    const maxHeight = Math.max(1, viewportHeight - topInset - bottomInset - rpx(20))
    let width = maxWidth
    let height = width / ratio
    if (height > maxHeight) {
      height = maxHeight
      width = height * ratio
    }
    return `width: ${Math.round(width)}px; height: ${Math.round(height)}px;`
  },

  showResult(poster) {
    clearTimeout(this._shareCloseTimer)
    this._shareCloseTimer = null
    this.setData({
      resultVisible: true,
      historyVisible: false,
      sizeVisible: false,
      sizeClosing: false,
      shareVisible: false,
      shareClosing: false,
      result: poster,
      currentPosterId: poster.id,
      resultPosterStyle: this.posterDisplayStyle(poster),
      sharePosterStyle: this.posterDisplayStyle(poster, true)
    })
    if (poster.status === 'ready') this.openShare()
    else if (poster.status === 'generating') this.startPolling(poster.id)
    else this.stopPolling()
  },

  // 一张海报有了新状态：同步到历史列表，正在看它时更新完成页；刚出好图就拉起分享层
  updateResult(poster) {
    const decorated = decoratePoster(poster, this.data.templates)
    const history = this.data.history.map((item) => (item.id === decorated.id ? decorated : item))
    const viewing = this.data.resultVisible && this.data.currentPosterId === decorated.id
    const wasGenerating = viewing && this.data.result.status === 'generating'
    this.setData({
      history,
      ...(viewing ? {
        result: decorated,
        resultPosterStyle: this.posterDisplayStyle(decorated),
        sharePosterStyle: this.posterDisplayStyle(decorated, true)
      } : {})
    })
    if (!viewing || !wasGenerating) return
    if (decorated.status === 'ready') this.openShare()
    if (decorated.status === 'failed') {
      wx.showToast({ title: FAILURE_TOASTS[decorated.failure] || '这次没有生成成功，请重新生成', icon: 'none' })
      // 失败不扣次数，刷新一下剩余次数
      this.loadCatalog({ silent: true })
    }
  },

  startPolling(posterId) {
    this.stopPolling()
    this._pollId = posterId
    this._pollStartedAt = Date.now()
    this.schedulePoll()
  },

  stopPolling() {
    clearTimeout(this._pollTimer)
    this._pollTimer = null
    this._pollId = ''
  },

  schedulePoll() {
    const posterId = this._pollId
    this._pollTimer = setTimeout(async () => {
      if (this._hidden || this._pollId !== posterId) return
      try {
        const poster = await loadAiPoster(posterId)
        if (this._pollId !== posterId) return
        this.updateResult(poster)
        if (poster.status !== 'generating') {
          this.stopPolling()
          return
        }
      } catch (error) {
        // 网络抖动时继续等；海报不在了就停
        if (error.code === 'POSTER_NOT_FOUND' || error.code === 'LOGIN_REQUIRED') {
          this.stopPolling()
          return
        }
      }
      if (Date.now() - this._pollStartedAt > POLL_LIMIT_MS) {
        this.stopPolling()
        wx.showToast({ title: '生成时间有点长，稍后在「海报历史」里查看', icon: 'none' })
        return
      }
      if (this._pollId === posterId) this.schedulePoll()
    }, POLL_INTERVAL_MS)
  },

  openHistory() {
    this.setData({ historyVisible: true })
    if (this._loadedOnce) this.loadCatalog({ silent: true })
  },

  closeHistory() {
    this.setData({ historyVisible: false })
  },

  handleHistoryPick(e) {
    const poster = this.data.history.find((item) => item.id === e.currentTarget.dataset.id)
    if (poster) this.showResult(poster)
  },

  openShare() {
    const result = this.data.result || {}
    if (result.status !== 'ready' || !result.imageUrl) return
    clearTimeout(this._shareCloseTimer)
    this._shareCloseTimer = null
    const composed = this._composed[result.id]
    this.setData({
      shareVisible: true,
      shareClosing: false,
      shareImageSrc: composed || result.imageUrl,
      composeFailed: false
    })
    if (!composed) return this.composePoster(result)
  },

  // 「复制链接」要在小程序链接页里操作：那一页的地址带着邀请码，复制出来的链接才带得上邀请人。
  // 邀请码一般在合成海报时已经取到；还没取到就让那一页自己取。
  handleOpenShareLink() {
    wx.navigateTo({ url: shareLinkPageUrl(this._promotionCode) })
  },

  closeShare() {
    if (!this.data.shareVisible || this.data.shareClosing) return
    this.setData({ shareClosing: true })
    this._shareCloseTimer = setTimeout(() => {
      this._shareCloseTimer = null
      this.setData({ shareVisible: false, shareClosing: false })
    }, SHARE_CLOSE_MS)
  },

  // 合成图＝海报 + 我的小程序码（白色圆底，画在右下角留白处，占海报宽度 14%，与海报详情同一套几何）。
  // 同一张海报在本页只合成一次；失败不挡保存，退回原图并提示。
  async composePoster(poster) {
    if (this._composing === poster.id) return
    this._composing = poster.id
    this.setData({ composingPoster: true, composeFailed: false })
    try {
      const [posterPath, qrPath] = await Promise.all([this.posterFile(poster), this.qrFile()])
      const composed = await this.drawShareImage(posterPath, qrPath)
      this._composed[poster.id] = composed
      if (this.data.currentPosterId === poster.id) this.setData({ shareImageSrc: composed })
    } catch (error) {
      if (this.data.currentPosterId === poster.id) this.setData({ composeFailed: true })
    } finally {
      if (this._composing === poster.id) this._composing = ''
      this.setData({ composingPoster: false })
    }
  },

  /**
   * 海报原图存成本地文件（canvas 与存相册都要本地路径）。海报在课程服务域名下，
   * 用 wx.request 取字节（该域名已在 request 合法域名里），不依赖 downloadFile 合法域名。
   */
  posterFile(poster) {
    this._posterFiles = this._posterFiles || {}
    if (this._posterFiles[poster.id]) return this._posterFiles[poster.id]
    const task = new Promise((resolve, reject) => {
      wx.request({
        url: poster.imageUrl,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: 30000,
        success: (response) => {
          if (response.statusCode !== 200 || !response.data) {
            reject(new Error('海报下载失败，请重试'))
            return
          }
          const filePath = `${wx.env.USER_DATA_PATH}/ai-poster-${poster.id}.jpg`
          wx.getFileSystemManager().writeFile({
            filePath,
            data: response.data,
            success: () => {
              this._localFiles.push(filePath)
              resolve(filePath)
            },
            fail: () => reject(new Error('海报暂存失败，请重试'))
          })
        },
        fail: () => reject(new Error('海报下载失败，请检查网络'))
      })
    })
    this._posterFiles[poster.id] = task
    task.catch(() => { delete this._posterFiles[poster.id] })
    return task
  },

  // 我的小程序码（邀请码中心签发，扫码进首页并带上我的邀请码）；本页只取一次
  qrFile() {
    if (this._qrFile) return this._qrFile
    this._qrFile = loadCurrentPromotionCode()
      .then((promoter) => {
        this._promotionCode = (promoter && promoter.promotionCode) || ''
        if (!promoter || !promoter.qrUrl) throw new Error('小程序码暂不可用')
        return new Promise((resolve, reject) => {
          wx.downloadFile({
            url: promoter.qrUrl,
            success: (result) => {
              if (result.statusCode === 200 && result.tempFilePath) resolve(result.tempFilePath)
              else reject(new Error('小程序码下载失败'))
            },
            fail: () => reject(new Error('小程序码下载失败'))
          })
        })
      })
    this._qrFile.catch(() => { this._qrFile = null })
    return this._qrFile
  },

  async drawShareImage(posterPath, qrPath) {
    const canvas = await this.shareCanvas()
    const [poster, qr] = await Promise.all([this.loadCanvasImage(canvas, posterPath), this.loadCanvasImage(canvas, qrPath)])
    const width = poster.width || 1080
    const height = poster.height || 1440
    const layout = posterQrLayout(width, height)
    if (!layout) throw new Error('海报尺寸异常')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(poster, 0, 0, width, height)
    // 白色圆底（比码大一圈，留出扫码安静区），再把码裁成圆形画在正中：
    // 邀请码中心给的码带白色方底，裁成圆后四角不会探出白色圆底
    ctx.save()
    ctx.beginPath()
    ctx.arc(layout.centerX, layout.centerY, layout.radius, 0, Math.PI * 2)
    ctx.closePath()
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()
    ctx.clip()
    ctx.drawImage(qr, layout.x, layout.y, layout.size, layout.size)
    ctx.restore()
    return this.exportCanvas(canvas, width, height)
  },

  shareCanvas() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#ai-poster-canvas')
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
        fileType: 'jpg',
        quality: 0.92,
        success: (result) => {
          if (result && result.tempFilePath) resolve(result.tempFilePath)
          else reject(new Error('海报导出失败'))
        },
        fail: () => reject(new Error('海报导出失败'))
      })
    })
  },

  // 有合成图就存合成图（带我的小程序码），否则存原图
  async handleSavePoster() {
    if (this.data.savingPoster) return
    const result = this.data.result || {}
    if (result.status !== 'ready') return
    this.setData({ savingPoster: true })
    try {
      const filePath = this._composed[result.id] || await this.posterFile(result)
      await this.saveToAlbum(filePath)
      this.closeShare()
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (error) {
      if (error && error.handled) return
      wx.showToast({ title: error && error.message || '海报保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ savingPoster: false })
    }
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

  noop() {}
})

