const { loadMeDashboard } = require('../../services/identity')
const { syncTab } = require('../../utils/navigation')

Page({
  data: {
    navigation: {},
    loading: true,
    loadFailed: false,
    refreshing: false,
    profile: null,
    balances: null,
    childUpdate: null,
    currentStudent: null,
    students: [],
    accountItems: [
      { id: 'family', icon: 'users', label: '家庭关系', meta: '绑定、切换与管理学生' },
      { id: 'guardianDashboard', icon: 'users', label: '家长学生看板', meta: '查看已绑定学生的学习摘要' },
      { id: 'orders', icon: 'bag', label: '购买课程积分', meta: '查看后台已上架的课程积分商品' },
      { id: 'messages', icon: 'message', label: '消息中心', meta: '课程、核验和家庭通知' }
    ],
    serviceItems: [
      { id: 'partner', icon: 'users', label: '推广伙伴', meta: '分享工具与奖励记录' },
      { id: 'learningProfile', icon: 'book', label: '学习档案', meta: '年级、教材与所在地区' },
      { id: 'identity', icon: 'shield', label: '身份与登录', meta: '实名、微信和手机号身份' },
      { id: 'redeem', icon: 'gift', label: '兑换码', meta: '兑换课程积分、金币或体验权益' },
      { id: 'service', icon: 'headphones', label: '企微服务', meta: '联系课程顾问和真人服务' }
    ]
  },

  onLoad() {
    this.setData({ navigation: getApp().globalData.navigation || {} })
  },

  async onShow() {
    syncTab(this, 3)
    await this.loadPage()
  },

  async onPullDownRefresh() {
    await this.loadPage(true)
    wx.stopPullDownRefresh()
  },

  async loadPage(refreshing = false) {
    if (this.data.refreshing) return
    this.setData({ loading: !refreshing && !this.data.profile, refreshing, loadFailed: false })
    try {
      const me = await loadMeDashboard()
      const selectedId = getApp().globalData.currentStudentId || me.currentStudentId
      const currentStudent = me.students.find((item) => item.id === selectedId) || me.students[0]
      this.setData({
        profile: me.profile,
        balances: me.balances,
        childUpdate: me.childUpdate,
        students: me.students,
        currentStudent
      })
    } catch (error) {
      this.setData({ loadFailed: true })
      wx.showToast({ title: error.message || '账户资料加载失败', icon: 'none' })
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

  handleEntry(event) {
    const labels = {
      family: '家庭关系',
      orders: '订单列表',
      messages: '消息中心',
      identity: '身份与登录管理',
      learningProfile: '学习档案',
      redeem: '兑换码',
      service: '企微服务',
      points: '课程积分',
      coins: '金币中心',
      child: '孩子学习动态',
      partner: '推广伙伴工作台'
    }
    const id = event.currentTarget.dataset.id
    if (id === 'points') {
      wx.navigateTo({ url: '/commerce/entitlements/index' })
      return
    }
    if (id === 'orders') {
      wx.navigateTo({ url: '/commerce/orders/index' })
      return
    }
    if (id === 'partner') {
      wx.navigateTo({ url: '/agent/application/index' })
      return
    }
    if (id === 'coins') {
      wx.navigateTo({ url: '/growth/coins/index' })
      return
    }
    if (id === 'redeem') {
      wx.navigateTo({ url: '/growth/redemption/index' })
      return
    }
    if (id === 'family') {
      wx.navigateTo({ url: '/account/family/index' })
      return
    }
    if (id === 'messages') {
      wx.navigateTo({ url: '/pages/messages/index' })
      return
    }
    if (id === 'guardianDashboard') {
      wx.navigateTo({ url: '/account/guardian-dashboard/index' })
      return
    }
    if (id === 'identity') {
      wx.navigateTo({ url: '/account/identity/index' })
      return
    }
    if (id === 'learningProfile') {
      wx.navigateTo({ url: '/pages/profile-setup/index?edit=1' })
      return
    }
    if (id === 'service') {
      wx.navigateTo({ url: '/account/service-contact/index' })
      return
    }
    if (id === 'child') {
      wx.navigateTo({ url: '/account/child-learning-feed/index' })
      return
    }
    wx.showToast({ title: `${labels[id] || '该页面'}将在下一批接入`, icon: 'none' })
  }
})
