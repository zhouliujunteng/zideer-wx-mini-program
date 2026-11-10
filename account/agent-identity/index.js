const { loadAgentIdentity, hasSession } = require('../../services/identity')
const { openLogin } = require('../../utils/access-gate')
const { rpxToPx } = require('../../utils/screen')

// 我的代理身份（2026-11-10，「我的」头像下的身份标签进入）：爱心妈妈、导师妈妈、爱心妈妈团团长，管理端「市场运营 → 代理身份」开通。
// 数据来自课程服务 /api/learn/agent-identity（lib/agent-roles/self.ts）：身份、所在团的团长、团长名下的爱心妈妈。
// 知鹿问答（help.zideer.cn）只能在微信里打开、认出代理身份才能看，小程序里打不开，这里给复制链接。
const HELP_SITE_URL = 'https://help.zideer.cn'

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    needLogin: false,
    roles: [],
    isLeader: false,
    leader: null,
    team: null,
    helpSiteUrl: HELP_SITE_URL
  },
  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375) })
  },
  onShow() { this.load() },
  async load() {
    if (!hasSession()) return this.setData({ loadFailed: !this.data.loaded, needLogin: true, errorMessage: '登录后查看你的代理身份。' })
    const version = this._version = (this._version || 0) + 1
    try {
      const result = await loadAgentIdentity()
      if (version !== this._version) return
      this.setData({
        loaded: true,
        loadFailed: false,
        needLogin: false,
        roles: result.roles,
        isLeader: result.roles.some((item) => item.key === 'team_leader'),
        leader: result.leader,
        team: result.team
      })
    } catch (error) {
      if (version !== this._version) return
      // 读到过一次就保留旧数据，只提示；第一次就失败才显示错误与重试
      if (this.data.loaded) return wx.showToast({ title: error.message || '代理身份暂时无法读取', icon: 'none' })
      this.setData({ loadFailed: true, needLogin: false, errorMessage: error.message || '代理身份暂时无法读取，请稍后重试。' })
    }
  },
  retry() {
    if (this.data.needLogin) return openLogin()
    this.setData({ loadFailed: false })
    this.load()
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  copyId(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) wx.setClipboardData({ data: id, success: () => wx.showToast({ title: 'ID 已复制', icon: 'none' }) })
  },
  copyHelpSite() {
    wx.setClipboardData({ data: HELP_SITE_URL, success: () => wx.showToast({ title: '链接已复制，请在微信里打开', icon: 'none' }) })
  }
})
