const { loadScoreToolRuns, deleteScoreToolRun, formatRunTime } = require('../../services/score-tools')

// 我的提分记录：最近 50 次工具分析（新的在前），点开看结果，长按删除。
// 删除只是不再显示：当天的免费次数照算（服务端规则）。

const STATUS_TEXT = { queued: '分析中', running: '分析中', failed: '没分析好' }

function decorate(run) {
  return {
    id: run.id,
    toolLabel: run.toolLabel,
    stem: run.question ? run.question.stem.replace(/\s+/g, ' ') : '',
    time: formatRunTime(run.createdAt),
    statusText: STATUS_TEXT[run.status] || '',
    status: run.status,
    creditsText: run.billing === 'credits' && run.status === 'succeeded' ? `${run.credits} 积分` : ''
  }
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    loadState: 'loading',
    loadError: '',
    runs: []
  },

  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = Number.isFinite(windowInfo.statusBarHeight) ? windowInfo.statusBarHeight : 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const menuTop = Number.isFinite(menuButton.top) ? menuButton.top : statusBarHeight + 6
    const menuHeight = Number.isFinite(menuButton.height) ? menuButton.height : 32
    const navigationBarHeight = menuHeight + (menuTop - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 12 })
  },

  onShow() {
    this.load()
  },

  async load() {
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    try {
      const runs = await loadScoreToolRuns()
      if (requestId !== this._requestId) return
      this._loaded = true
      this.setData({ loadState: 'ready', loadError: '', runs: runs.map(decorate) })
    } catch (error) {
      if (requestId !== this._requestId) return
      // 读到过一次就保留旧列表，只提示
      if (this._loaded) wx.showToast({ title: error.message || '刷新失败', icon: 'none' })
      else this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  retry() {
    this.setData({ loadState: 'loading' })
    this.load()
  },

  handleBack() {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: '/pages/home/index' })
  },

  openRun(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (/^[a-f0-9]{32}$/.test(id)) wx.navigateTo({ url: `/score-tools/tool/index?runId=${id}` })
  },

  askDelete(e) {
    const id = String(e.currentTarget.dataset.id || '')
    wx.showModal({
      title: '删除这条记录？',
      content: '删除后看不到这次的分析结果，今天已用的次数不会退回。',
      confirmText: '删除',
      confirmColor: '#E5484D',
      success: async (result) => {
        if (!result.confirm) return
        try {
          await deleteScoreToolRun(id)
          this.setData({ runs: this.data.runs.filter((run) => run.id !== id) })
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败，请重试', icon: 'none' })
        }
      }
    })
  }
})
