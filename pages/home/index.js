const { loadHomeDashboard } = require('../../services/identity')
const { syncTab, switchTab } = require('../../utils/navigation')

function formatToday() {
  const now = new Date()
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${now.getMonth() + 1}月${now.getDate()}日 · ${weekdays[now.getDay()]}`
}

Page({
  data: {
    navigation: {},
    loading: true,
    loadFailed: false,
    refreshing: false,
    dateLabel: '',
    currentStudent: null,
    students: [],
    today: null,
    assessment: null,
    plan: null,
    balances: null,
    message: null
  },

  onLoad() {
    this.setData({
      navigation: getApp().globalData.navigation || {},
      dateLabel: formatToday()
    })
  },

  async onShow() {
    syncTab(this, 0)
    await this.loadPage()
  },

  async onPullDownRefresh() {
    await this.loadPage(true)
    wx.stopPullDownRefresh()
  },

  async loadPage(refreshing = false) {
    if (this.data.refreshing) return
    this.setData({ loading: !refreshing && !this.data.today, refreshing, loadFailed: false })
    try {
      const home = await loadHomeDashboard()
      const selectedId = getApp().globalData.currentStudentId || home.currentStudentId
      const currentStudent = home.students.find((item) => item.id === selectedId) || home.students[0]
      getApp().globalData.currentStudentId = currentStudent.id
      this.setData({
        students: home.students,
        currentStudent,
        today: home.today,
        assessment: home.assessment,
        plan: home.plan,
        balances: home.balances,
        message: home.message
      })
    } catch (error) {
      this.setData({ loadFailed: true })
      wx.showToast({ title: error.message || '首页加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },

  chooseStudent() {
    const names = this.data.students.map((item) => `${item.name} · ${item.relation}`)
    wx.showActionSheet({
      itemList: names,
      success: ({ tapIndex }) => {
        const currentStudent = this.data.students[tapIndex]
        getApp().globalData.currentStudentId = currentStudent.id
        this.setData({ currentStudent })
      }
    })
  },

  continueLearning() {
    switchTab(1)
  },

  openKnowledgeMap() {
    switchTab(2)
  },

  openCreditAccount() {
    wx.navigateTo({ url: '/commerce/entitlements/index' })
  },

  openCoinCenter() {
    wx.navigateTo({ url: '/growth/coins/index' })
  },

  startAssessment() {
    wx.navigateTo({ url: '/assessment/center/index' })
  },

  openProductIntro() {
    wx.navigateTo({ url: '/pages/product-intro/index' })
  },

  showUpcoming() {
    wx.navigateTo({ url: '/pages/messages/index' })
  }
})
