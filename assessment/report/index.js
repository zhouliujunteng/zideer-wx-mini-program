// 学科测评报告（设计稿 ui-ref M17，2026-09-30）：摸底诊断每轮提交后的累计报告。
// 答题页（assessment/short）提交后换到这里；测评列表、测评中心、图谱里点已完成的测评也经答题页转过来。
// 数据来自测评动作流 read（attempt.report），视图模型见 utils/assessment-report.js；没有真实数据的模块不画。
const assessment = require('../../services/assessment')
const { loadCurrentUser } = require('../../services/identity')
const { attachUiAssets, getUiAssets } = require('../../services/ui-assets')
const { buildReportModel, radarLabelLines } = require('../../utils/assessment-report')
const { columnWidth } = require('../../utils/screen')
const { drawReportShare, reportSharePages } = require('./share-image')

const SHARE_SCALE = 1.5
// 分享长图里要画的图片（画布只能画本地文件，先下载）：章节图标与默认头像取自后端素材表。
const SHARE_ICON_KEYS = {
  mastery: 'assessment-report/mastery.png',
  weak: 'assessment-report/weak-points.png',
  path: 'assessment-report/learning-path.png'
}
const DEFAULT_AVATAR_KEY = 'avatar/default.png'

// 包内图片 getImageInfo 返回不带开头斜杠的相对路径，drawImage 会按页面目录去找、整张画布画不出来（回调也不来），补成绝对路径。
function localImage(src) {
  if (!src || !wx.getImageInfo) return Promise.resolve('')
  return new Promise((resolve) => {
    wx.getImageInfo({
      src,
      success: (info) => {
        const file = String(info.path || '')
        resolve(!file || /^(\/|[a-z]+:)/i.test(file) ? file : `/${file}`)
      },
      fail: () => resolve('')
    })
  })
}
const SHARE_DRAW_TIMEOUT = 10000

// 题目配图点开看大图：一道题的配图（题干 → 选项 → 解析）放在同一组里左右滑动。
function figureUrls(question) {
  if (!question) return []
  const groups = [question.figures].concat((question.options || []).map((option) => option && option.figures), [question.explanationFigures])
  const urls = []
  groups.forEach((list) => (list || []).forEach((figure) => { if (figure && figure.url && urls.indexOf(figure.url) < 0) urls.push(figure.url) }))
  return urls
}

// 报告页底部按钮：做完整张卷可以再测一次；更新的一张卷还在做时改成接着做它。
function retakeLabel(retake) {
  if (!retake) return ''
  if (retake.mode === 'retake') return '再测一次'
  return `继续第 ${retake.paperCount} 次测评`
}

Page({
  data: {
    model: null,
    radarImage: '',
    failed: false,
    error: '',
    busy: false,
    retake: null,
    retakeLabel: '',
    // 和上次比、历次成绩（services/assessment 的 retakeCompareView）：读到后才有，读不到保持 null、不画占位
    compare: null,
    openReview: -1,
    failedFigures: [],
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    shareButtonTop: 28,
    shareButtonRight: 76,
    shareButtonSize: 32,
    shareVisible: false,
    sharePreviewBottom: 230,
    sharePreviewOverlap: 28,
    shareImageLoading: false,
    shareImagePath: '', shareImagePaths: [],
    shareCanvasWidth: 720,
    shareCanvasHeight: 3600
  },

  onLoad(options) {
    this.attemptId = /^[1-9][0-9]*$/.test(String((options && options.attemptId) || '')) ? String(options.attemptId) : ''
    this.requestVersion = 0
    attachUiAssets(this)
    const info = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {})
    const statusBarHeight = info.statusBarHeight || 20
    const windowWidth = info.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { left: windowWidth - 92, top: statusBarHeight + 6, width: 87, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.shareWidth = Math.max(300, columnWidth(windowWidth) - 48)
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 8,
      shareButtonTop: menuButton.top + Math.max(0, (menuButton.height - 32) / 2),
      shareButtonRight: Math.max(8, windowWidth - menuButton.left + 8),
      shareButtonSize: Math.min(32, menuButton.height),
      shareCanvasWidth: Math.round(this.shareWidth * SHARE_SCALE)
    })
    this.loadReport()
  },

  onUnload() {
    this.requestVersion++
    clearTimeout(this._shareDrawTimer)
  },


  async loadReport() {
    const version = ++this.requestVersion
    this.setData({ failed: false, error: '' })
    if (!this.attemptId) {
      this.setData({ failed: true, error: '没有找到这次测评。' })
      return
    }
    try {
      const [result, user] = await Promise.all([
        assessment.call('read', { attemptId: this.attemptId }),
        loadCurrentUser().catch(() => null)
      ])
      if (version !== this.requestVersion) return
      const attempt = result && result.attempt
      // 还没提交的测评没有报告：回答题页接着做。
      if (!attempt || attempt.status !== 'submitted' || !attempt.report) {
        wx.redirectTo({ url: `/assessment/short/index?attemptId=${encodeURIComponent(this.attemptId)}` })
        return
      }
      const profile = user && user.profile
      const student = { name: (profile && profile.nickname) || '同学', avatarUrl: (profile && profile.avatar_url) || '' }
      const model = buildReportModel(assessment.reportView(attempt.report), student)
      // 做完整张卷的报告带 retake（2026-10-03 起可以再测一次）：再测过的标上第几次。
      const retake = attempt.retake || null
      if (model && retake && retake.paperCount > 1) model.period = `第 ${retake.paperNumber} 次 · ${model.period}`
      this.setData({ model, retake, retakeLabel: retakeLabel(retake), radarImage: '' }, () => this.drawRadar())
      if (!this.data.compare) this.loadCompare(attempt.report, retake, version)
    } catch (error) {
      if (version !== this.requestVersion) return
      this.setData({ failed: true, error: (error && error.message) || '报告暂时读不到' })
    }
  },

  // 和上次比（2026-10-06）：同一范围做过两次以上（retake.paperCount > 1，只有做完整张卷的报告带 retake）时，
  // 读测评目录里这个范围的历次成绩（entry.history），再读上一次的报告比知识点掌握状态。
  // 主报告不等它；目录读不到就不显示，上一次的报告读不到就只比分数与档位。
  async loadCompare(report, retake, version) {
    const scope = report && report.scope
    if (!retake || !(Number(retake.paperCount) > 1) || !scope || scope.id == null) return
    const attemptId = this.attemptId
    try {
      const catalog = await assessment.call('catalog', { subject: scope.subject || '' })
      if (version !== this.requestVersion) return
      const found = ((catalog && catalog.scopes) || []).find((item) => String(item.id) === String(scope.id))
      const history = found && found.entry && found.entry.history
      let compare = assessment.retakeCompareView(history, attemptId, report, null)
      if (!compare) return
      if (compare.previousAttemptId) {
        try {
          const prior = await assessment.call('read', { attemptId: compare.previousAttemptId })
          if (version !== this.requestVersion) return
          const priorReport = prior && prior.attempt && prior.attempt.status === 'submitted' ? prior.attempt.report : null
          if (priorReport) compare = assessment.retakeCompareView(history, attemptId, report, priorReport)
        } catch (error) {
          if (version !== this.requestVersion) return
        }
      }
      this.setData({ compare })
    } catch (error) {
      // 对比是附加信息：读不到不提示、不占位
    }
  },

  // 历次成绩里点另一次：打开那一次的报告（本次不响应）。页面栈快满时换掉本页，免得打不开。
  openHistoryReport(event) {
    const id = String(event.currentTarget.dataset.attemptId || '')
    if (!/^[1-9][0-9]*$/.test(id) || id === String(this.attemptId)) return
    const url = `/assessment/report/index?attemptId=${encodeURIComponent(id)}`
    if (getCurrentPages().length >= 9) wx.redirectTo({ url })
    else wx.navigateTo({ url })
  },

  retryLoad() { this.loadReport() },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) { wx.navigateBack({ delta: 1 }); return }
    wx.redirectTo({ url: '/assessment/short/index' })
  },

  // 下一轮：同一范围再次 start，服务端按卷进度开出下一轮，回答题页作答。
  async startNextRound() {
    const model = this.data.model
    if (this.data.busy || !model || !model.nextRound || !model.scopeId) return
    this.setData({ busy: true })
    try {
      const result = await assessment.call('start', { scopeId: model.scopeId })
      const attempt = result && result.attempt
      if (!attempt || !attempt.id) throw new Error('下一轮暂时开不了，请稍后再试')
      wx.redirectTo({ url: `/assessment/short/index?attemptId=${encodeURIComponent(attempt.id)}` })
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '下一轮暂时开不了，请稍后再试', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  // 再测一次：同一范围开一张新卷（以前的报告保留）；更新的一张卷还没做完时接着做那张。
  retake() {
    const retake = this.data.retake, model = this.data.model
    if (this.data.busy || !retake || !model || !model.scopeId) return
    if (retake.mode === 'resume' && retake.attemptId) {
      wx.redirectTo({ url: `/assessment/short/index?attemptId=${encodeURIComponent(retake.attemptId)}` })
      return
    }
    if (retake.mode !== 'retake') { this.startRetake(false); return }
    wx.showModal({
      title: '再测一次',
      content: '会重新出一套题，优先出上次没做过的题。这份报告会保留，可以在测评记录里查看。',
      confirmText: '开始',
      confirmColor: '#FD7C02',
      success: (res) => { if (res.confirm) this.startRetake(true) }
    })
  },
  async startRetake(fresh) {
    const model = this.data.model
    this.setData({ busy: true })
    try {
      const result = await assessment.call('start', { scopeId: model.scopeId, retake: fresh })
      const attempt = result && result.attempt
      if (!attempt || !attempt.id) throw new Error('暂时开不了新的测评，请稍后再试')
      wx.redirectTo({ url: `/assessment/short/index?attemptId=${encodeURIComponent(attempt.id)}` })
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '暂时开不了新的测评，请稍后再试', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  // 继续测评：回测评中心；中心已经在页面栈里就退回去，不再叠一层。
  openAssessmentCenter() {
    const pages = getCurrentPages()
    const index = pages.map((page) => page.route).lastIndexOf('assessment/center/index')
    if (index >= 0) { wx.navigateBack({ delta: pages.length - 1 - index }); return }
    wx.navigateTo({ url: '/assessment/center/index' })
  },

  openKnowledgeMap() { wx.navigateTo({ url: '/pages/knowledge-map/index' }) },

  openTopic(event) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/diagnosis/topic/index?topicId=${encodeURIComponent(id)}` })
  },

  toggleReview(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ openReview: this.data.openReview === index ? -1 : index })
  },

  previewFigure(event) {
    const { url, group } = event.currentTarget.dataset
    if (!url) return
    const question = ((this.data.model && this.data.model.review) || []).find((item) => String(item.questionId) === String(group))
    const urls = figureUrls(question)
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },

  // 配图没加载出来（签名过期、网络断开）：换成提示，点一下重读报告拿新的图片地址。
  figureFailed(event) {
    const url = event.currentTarget.dataset.url
    if (!url || this.data.failedFigures.indexOf(url) >= 0) return
    this.setData({ failedFigures: this.data.failedFigures.concat(url) })
  },

  retryFigures() {
    this.setData({ failedFigures: [] })
    this.loadReport()
  },

  // 雷达图在 2d 画布上画好后立刻导出成图片显示：原生画布在滚动容器里不跟着滚，还会盖住固定的顶栏和底栏。
  drawRadar() {
    const dimensions = this.data.model && this.data.model.radar
    if (!dimensions || dimensions.length < 3 || this.data.shareVisible || this.data.radarImage) return
    wx.createSelectorQuery().in(this).select('#masteryRadar').fields({ node: true, size: true }, (rect) => {
      if (!rect || !rect.node || !rect.width || !rect.height) return
      const canvas = rect.node
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const dpr = Math.min(info.pixelRatio || 2, 3)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const context = canvas.getContext('2d')
      context.scale(dpr, dpr)
      const count = dimensions.length
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const radius = Math.min(rect.width * 0.24, rect.height * 0.30)
      const pointAt = (index, scale) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / count
        return { x: centerX + Math.cos(angle) * radius * scale, y: centerY + Math.sin(angle) * radius * scale }
      }
      const polygon = (scaleAt) => {
        dimensions.forEach((dimension, index) => {
          const point = pointAt(index, scaleAt(dimension))
          if (index === 0) context.moveTo(point.x, point.y)
          else context.lineTo(point.x, point.y)
        })
        context.closePath()
      }
      const ratio = (dimension) => Math.max(0, Math.min(100, dimension.value)) / 100

      context.lineWidth = 1
      for (let ring = 1; ring <= 4; ring += 1) {
        context.beginPath()
        polygon(() => ring / 4)
        context.strokeStyle = ring === 4 ? 'rgba(207,120,125,0.35)' : 'rgba(207,120,125,0.19)'
        context.stroke()
      }
      dimensions.forEach((dimension, index) => {
        const point = pointAt(index, 1)
        context.beginPath()
        context.moveTo(centerX, centerY)
        context.lineTo(point.x, point.y)
        context.strokeStyle = 'rgba(207,120,125,0.20)'
        context.stroke()
      })
      context.beginPath()
      polygon(ratio)
      context.fillStyle = 'rgba(242,99,104,0.18)'
      context.strokeStyle = '#F26368'
      context.lineWidth = 2.5
      context.fill()
      context.stroke()
      dimensions.forEach((dimension, index) => {
        const point = pointAt(index, ratio(dimension))
        context.beginPath()
        context.arc(point.x, point.y, 3.5, 0, Math.PI * 2)
        context.fillStyle = dimension.color
        context.fill()
        const label = pointAt(index, 1.25)
        const align = label.x < centerX - 8 ? 'right' : label.x > centerX + 8 ? 'left' : 'center'
        const room = align === 'left' ? rect.width - label.x : align === 'right' ? label.x : rect.width
        context.textAlign = align
        context.textBaseline = 'middle'
        context.font = '9px sans-serif'
        context.fillStyle = '#75666B'
        // 单元名、知识点名放不下时折成两行（完整名称在无障碍文本里）
        const lines = radarLabelLines(dimension.label, room - 2, (text) => context.measureText(text).width)
        const shift = (lines.length - 1) * 5.5
        lines.forEach((line, lineIndex) => context.fillText(line, label.x, label.y - 5 - shift + lineIndex * 11))
        context.font = 'bold 8px sans-serif'
        context.fillStyle = dimension.color
        context.fillText(`${dimension.value}%`, label.x, label.y + 7 + shift)
      })
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'png',
        success: (result) => { if (this.data.model && this.data.model.radar === dimensions) this.setData({ radarImage: result.tempFilePath }) }
      }, this)
    }).exec()
  },

  openShare() {
    if (!this.data.model) return
    this.setData({ shareVisible: true, shareImageLoading: true, shareImagePath: '', shareImagePaths: [] }, () => {
      wx.createSelectorQuery().in(this).select('.report-share-sheet').boundingClientRect((rect) => {
        if (rect && rect.height) this.setData({ sharePreviewBottom: Math.ceil(rect.height) })
      }).exec()
      this.drawShareImage()
    })
  },

  closeShare() {
    this.setData({ shareVisible: false }, () => this.drawRadar())
  },

  noop() {},

  shareImages() {
    if (this._shareImages) return this._shareImages
    const ui = getUiAssets()
    const model = this.data.model
    const keys = Object.keys(SHARE_ICON_KEYS)
    this._shareImages = Promise.all([localImage(model.student.avatarUrl || ui[DEFAULT_AVATAR_KEY])]
      .concat(keys.map((key) => localImage(ui[SHARE_ICON_KEYS[key]]))))
      .then(([avatar, ...icons]) => {
        const images = { avatar }
        keys.forEach((key, index) => { images[key] = icons[index] })
        return images
      })
    return this._shareImages
  },

  async drawShareImage() {
    const fullModel = this.data.model
    const images = await this.shareImages()
    if (!this.data.shareVisible) return
    const options = { width: this.shareWidth, topInset: Math.max(40, (this.data.statusBarHeight || 20) + 20), scale: SHARE_SCALE, images }
    // 第一遍只量高度（不调用 draw，画布上不会出现），按实际高度设好画布再画。
    const measure = part => drawReportShare(wx.createCanvasContext('reportShareCanvas', this), part, options)
    const models = reportSharePages(fullModel, measure, 4000 / SHARE_SCALE)
    const paths = []
    const drawPage = (pageIndex) => {
    const model = models[pageIndex]
    const height = measure(model)
    const canvasHeight = Math.ceil(height * SHARE_SCALE)
    const drawId = (this._shareDrawId || 0) + 1
    this._shareDrawId = drawId
    const failed = () => {
      if (this._shareDrawId !== drawId) return
      this._shareDrawId = drawId + 1
      this.setData({ shareImageLoading: false })
      if (this.data.shareVisible) wx.showToast({ title: '长图生成失败，请重新打开分享', icon: 'none' })
    }
    // 画布偶尔不回调（图片画不出来等）：超时就停下，别让弹窗一直转圈。
    clearTimeout(this._shareDrawTimer)
    this._shareDrawTimer = setTimeout(failed, SHARE_DRAW_TIMEOUT)
    this.setData({ shareCanvasHeight: canvasHeight }, () => {
      const ctx = wx.createCanvasContext('reportShareCanvas', this)
      drawReportShare(ctx, model, { ...options, height })
      ctx.draw(false, () => {
        if (this._shareDrawId !== drawId) return
        wx.canvasToTempFilePath({
          canvasId: 'reportShareCanvas',
          x: 0,
          y: 0,
          width: this.data.shareCanvasWidth,
          height: canvasHeight,
          destWidth: this.data.shareCanvasWidth,
          destHeight: canvasHeight,
          fileType: 'png',
          success: (result) => {
            if (this._shareDrawId !== drawId) return
            clearTimeout(this._shareDrawTimer)
            paths.push(result.tempFilePath)
            if (pageIndex + 1 < models.length) { drawPage(pageIndex + 1); return }
            this._reportSharePath = paths[0]
            this.setData({ shareImagePath: paths[0], shareImagePaths: paths, shareImageLoading: false })
          },
          fail: () => { clearTimeout(this._shareDrawTimer); failed() }
        }, this)
      })
    })
    }
    drawPage(0)
  },

  handleShareAction(event) {
    if (this.data.shareImageLoading || !this.data.shareImagePath) {
      wx.showToast({ title: '长图正在生成，请稍候', icon: 'none' })
      return
    }
    const action = event.currentTarget.dataset.action
    if (action === 'save') this.saveShareImage('已保存到相册')
    // 朋友圈：报告页要登录才看得到，不把本页分享出去；长图存进相册，由学生自己发朋友圈。
    if (action === 'timeline') this.saveShareImage('', () => wx.showModal({ title: '长图已保存到相册', content: '打开微信朋友圈，选择这张图片即可发布。', showCancel: false, confirmText: '知道了' }))
  },

  saveShareImage(toast, done) {
    const paths = this.data.shareImagePaths.length ? this.data.shareImagePaths : [this.data.shareImagePath]
    const save = index => wx.saveImageToPhotosAlbum({
      filePath: paths[index],
      success: () => {
        if (index + 1 < paths.length) { save(index + 1); return }
        this.closeShare()
        if (toast) wx.showToast({ title: toast, icon: 'success' })
        if (done) done()
      },
      fail: (error) => {
        // 取消不提示；没同意隐私指引、手机系统没给微信相册权限、设置里关了相册，各自说明（utils/permission-guide.js，2026-10-06）
        const { guideOnFailure } = require('../../utils/permission-guide')
        guideOnFailure(error, { scope: 'scope.writePhotosAlbum', content: '保存长图需要允许访问相册，请在设置里打开相册权限后再试。' })
          .then((kind) => { if (kind === 'other') wx.showToast({ title: '保存失败，请重试', icon: 'none' }) })
      }
    })
    save(0)
  },

  // 分享给好友：卡片图用生成好的长图；好友点开进首页（报告只有本人登录后看得到）。
  onShareAppMessage() {
    const model = this.data.model
    const result = { title: model ? `${model.student.name}的${model.context}测评报告` : '知鹿学习 · 学科测评报告', path: '/pages/home/index' }
    if (this._reportSharePath) result.imageUrl = this._reportSharePath
    return result
  }
})
