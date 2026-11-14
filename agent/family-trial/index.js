const {
  loadAgentTrial,
  openAgentTrialTest,
  requestAgentTrialMeeting,
  loadAgentTrialScript,
  downloadAgentTrialReport
} = require('../../services/identity')
const { rpxToPx } = require('../../utils/screen')
const { gradeName } = require('../../utils/grade-name')

// 免费体验（2026-11-11 用户规则）：爱心妈妈 / 团长带来的新家庭，一个家庭一次——
// ① 免费基础测评（选一个孩子开通，孩子在「目标」页定目标后开测，测完给代理 PDF 报告和话术）；
// ② 免费诊断会议（代理申请，平台安排老师）；③ 没开会员时免费生成 3 节定制课。
// 规则都在课程服务 /api/learn/agent-trial（lib/agent-trial），这里只展示。
const TEST_TEXT = {
  waiting: '已开通，等孩子开始测评',
  testing: '孩子正在测评',
  failed: '测评没有开始成功',
  done: '已测完'
}
const MEETING_TEXT = {
  requested: '已申请，等平台安排老师和时间',
  arranged: '平台已安排',
  closed: '平台已关闭这次申请'
}

// 已申请：还没有老师接单时等老师接单；有老师接了写出是哪位老师（2026-11-13 诊断会议派单）。
function meetingText(meeting) {
  if (meeting.status === 'requested') return meeting.teacherName ? `${meeting.teacherName}已接单，会联系你约具体时间` : '已申请，已通知服务老师，等老师接单'
  if (meeting.status === 'arranged') return meeting.teacherName ? `${meeting.teacherName}已约好会议` : MEETING_TEXT.arranged
  return MEETING_TEXT[meeting.status] || ''
}

// 会议约好后转给家庭的进会议链接（2026-11-14 用户要求，课程服务 lib/agent-trial/meeting-link.ts）：
// 孩子是小程序学生 → 小程序链接（#小程序://…，生成不了时用转发卡片）；孩子是网页端孩子 → 网页版诊断室链接。
function two(n) { return n < 10 ? `0${n}` : `${n}` }
function meetingTimeText(iso) {
  const at = new Date(iso)
  if (!iso || Number.isNaN(at.getTime())) return ''
  return `${at.getMonth() + 1}月${at.getDate()}日 ${two(at.getHours())}:${two(at.getMinutes())}`
}
function linkView(link) {
  const web = link.kind === 'web'
  return {
    studentProfileId: link.studentProfileId,
    name: link.name || '孩子',
    web,
    url: link.url || '',
    path: link.path || '',
    timeText: meetingTimeText(link.scheduledAt),
    title: web ? '网页版诊断室链接' : '小程序会议链接',
    tip: web
      ? '孩子用的是网页端账号。把链接发给家长，在电脑或平板的浏览器里打开，登录孩子的账号后直接进诊断室。'
      : '把链接发给家长，家长转给孩子或自己打开都行：孩子点开进诊断室，家长点开可以旁听。',
    copyText: web
      ? `诊断会议${meetingTimeText(link.scheduledAt) ? `（${meetingTimeText(link.scheduledAt)}）` : ''}请用浏览器打开，登录孩子的账号后进入：${link.url || ''}`
      : link.url || ''
  }
}

function childLabel(child) {
  return [child.name, child.grade ? gradeName(child.grade) : ''].filter(Boolean).join(' · ')
}

function viewOf(result) {
  const test = result.test || {}
  return {
    family: result.family,
    children: (result.children || []).map((c) => ({ ...c, label: childLabel(c) })),
    testState: test.state || 'none',
    testText: TEST_TEXT[test.state] || '',
    testChild: test.child,
    result: test.result,
    script: result.script ? result.script.text : '',
    meeting: result.meeting || { status: 'none' },
    meetingChildText: ((result.meeting || {}).children || []).map(childLabel).join('、'),
    meetingText: meetingText(result.meeting || {}),
    meetingLinks: ((result.meeting || {}).links || []).map(linkView),
    lessons: result.lessons || { used: 0, limit: 3 }
  }
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    view: null,
    pickedChild: 0,
    opening: false,
    scriptLoading: false,
    scriptError: '',
    reportLoading: false,
    // 给哪个孩子约诊断会议：老师接单后加到自己学生里的就是这个孩子
    meetingChild: 0,
    meetingNote: '',
    meetingSubmitting: false
  },
  onLoad(query) {
    this.guardianPublicId = String((query && query.guardianPublicId) || '')
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375) })
  },
  onShow() { this.load() },
  apply(result) {
    const view = viewOf(result)
    const current = view.testChild ? view.testChild.studentProfileId : 0
    const pickedChild = this.data.pickedChild && view.children.some((c) => c.studentProfileId === this.data.pickedChild)
      ? this.data.pickedChild
      : current || (view.children.length === 1 ? view.children[0].studentProfileId : 0)
    // 约会议的孩子：选过的保留；没选过默认做免费测评的那个孩子，只有一个孩子就是他
    const meetingChild = this.data.meetingChild && view.children.some((c) => c.studentProfileId === this.data.meetingChild)
      ? this.data.meetingChild
      : current || (view.children.length === 1 ? view.children[0].studentProfileId : 0)
    this.setData({ loaded: true, loadFailed: false, view, pickedChild, meetingChild })
  },
  async load() {
    try {
      this.apply(await loadAgentTrial(this.guardianPublicId))
    } catch (error) {
      if (this.data.loaded) return wx.showToast({ title: error.message || '免费体验暂时无法读取', icon: 'none' })
      this.setData({ loadFailed: true, errorMessage: error.message || '免费体验暂时无法读取，请稍后重试。' })
    }
  },
  retry() { this.setData({ loadFailed: false }); this.load() },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.redirectTo({ url: '/agent/bind-family/index' })
  },
  pickChild(event) {
    this.setData({ pickedChild: Number(event.currentTarget.dataset.id) || 0 })
  },
  handleOpenTest() {
    const view = this.data.view
    const child = view && view.children.find((c) => c.studentProfileId === this.data.pickedChild)
    if (!child || this.data.opening) return wx.showToast({ title: '请先选一个孩子', icon: 'none' })
    const switching = view.testState === 'waiting'
    wx.showModal({
      title: switching ? `换成给${child.name}测？` : `给${child.name}开通免费测评？`,
      content: '一个家庭只有一次免费测评。孩子开始测以后就不能再换人了。',
      confirmText: switching ? '换成这个孩子' : '开通',
      confirmColor: '#FD7C02',
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ opening: true })
        try {
          this.apply(await openAgentTrialTest(this.guardianPublicId, child.studentProfileId))
          wx.showToast({ title: '已开通', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: error.message || '没有开通成功', icon: 'none' })
        } finally {
          this.setData({ opening: false })
        }
      }
    })
  },
  async handleReport() {
    if (this.data.reportLoading) return
    this.setData({ reportLoading: true })
    try {
      const filePath = await downloadAgentTrialReport(this.guardianPublicId)
      wx.openDocument({ filePath, fileType: 'pdf', showMenu: true, fail: () => wx.showToast({ title: '报告打不开，请稍后重试', icon: 'none' }) })
    } catch (error) {
      wx.showToast({ title: error.message || '报告暂时生成不了', icon: 'none' })
    } finally {
      this.setData({ reportLoading: false })
    }
  },
  async handleScript(event) {
    if (this.data.scriptLoading) return
    const regenerate = !!(event && event.currentTarget.dataset.regenerate)
    this.setData({ scriptLoading: true, scriptError: '' })
    try {
      const result = await loadAgentTrialScript(this.guardianPublicId, regenerate)
      this.setData({ 'view.script': result.script || '' })
    } catch (error) {
      this.setData({ scriptError: error.message || '话术没有写好，请再点一次。' })
    } finally {
      this.setData({ scriptLoading: false })
    }
  },
  copyScript() {
    const text = this.data.view && this.data.view.script
    if (text) wx.setClipboardData({ data: text })
  },
  copyMeetingLink(event) {
    const link = ((this.data.view && this.data.view.meetingLinks) || [])[Number(event.currentTarget.dataset.index) || 0]
    if (!link || !link.copyText) return
    wx.setClipboardData({ data: link.copyText, success: () => wx.showToast({ title: '已复制，发给家长吧', icon: 'none' }) })
  },
  // 小程序孩子：转发邀请页的卡片（点「转发给家长」的按钮才带邀请；右上角转发的是普通首页）
  onShareAppMessage(res) {
    const dataset = (res && res.from === 'button' && res.target && res.target.dataset) || {}
    const link = ((this.data.view && this.data.view.meetingLinks) || [])[Number(dataset.index) || 0]
    if (!dataset.meeting || !link || !link.path) return { title: '知鹿学习', path: '/pages/home/index' }
    return { title: `${link.name}的诊断会议${link.timeText ? `（${link.timeText}）` : ''}，点开进入`, path: link.path }
  },
  pickMeetingChild(event) {
    if (!this.data.meetingSubmitting) this.setData({ meetingChild: Number(event.currentTarget.dataset.id) || 0 })
  },
  handleMeetingInput(event) {
    this.setData({ meetingNote: String(event.detail.value || '') })
  },
  async handleMeeting() {
    const note = this.data.meetingNote.trim()
    if (this.data.meetingSubmitting) return
    const view = this.data.view
    if (!view || !view.children.length) return wx.showToast({ title: '请家长先绑定孩子，再申请诊断会议', icon: 'none' })
    const child = view.children.find((c) => c.studentProfileId === this.data.meetingChild)
    if (!child) return wx.showToast({ title: '请先选给哪个孩子约', icon: 'none' })
    if (!note) return wx.showToast({ title: '请写一下方便的时间和想解决的问题', icon: 'none' })
    this.setData({ meetingSubmitting: true })
    try {
      this.apply(await requestAgentTrialMeeting(this.guardianPublicId, note, child.studentProfileId))
      this.setData({ meetingNote: '' })
      wx.showToast({ title: '已提交申请', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message || '申请没有提交成功', icon: 'none' })
    } finally {
      this.setData({ meetingSubmitting: false })
    }
  }
})
