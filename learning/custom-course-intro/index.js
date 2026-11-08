const { loadViewerAccess, loadMemberCourseLibrary } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { openLogin, openProfileSetup } = require('../../utils/access-gate')
const { rpxToPx } = require('../../utils/screen')
const { openPaymentPage, attachPaymentSwitch } = require('../../services/payment-switch')

// 定制课程介绍（2026-09-30 用户要求）：从首页、会员课程全部页点会员课程时，没登录或不是会员的进这一页，
// 先讲清楚知鹿的定制课程是什么、怎么开始，再给下一步（登录 / 完善学习资料 / 开通会员）。
// 游客也能看（services/identity.js GUEST_BROWSABLE_ROUTES），不强制登录。
//
// 底部按钮按访问状态走（cta）：
//   guest   没登录 → 登录（登录页 navigateBack 回到本页）
//   profile 已登录、没完善学习资料 → 完善学习资料
//   join    不是会员 → 会员中心
//   member  已是会员（开通后回到本页）→ 直接进刚才点的课程
// 第一次判断出访问状态前按钮位画骨架，不先显示某个按钮再换。

const MAX_TITLE_LENGTH = 40

function courseTitleOf(value) {
  let title = String(value || '')
  try { title = decodeURIComponent(title) } catch (error) { /* 原样用 */ }
  title = title.replace(/\s+/g, ' ').trim()
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH)}…` : title
}

Page({
  data: {
    // 支付开关开着才显示会员中心 / 积分包入口（services/payment-switch.js attachPaymentSwitch，没读到过按关着）
    paymentOpen: false,
    statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80, topbarSolid: false,
    courseTitle: '',
    // 判断出访问状态前为空（按钮位是骨架）
    cta: '',
    features: [
      { id: 'fit', index: '01', title: '按你的基础来讲', copy: '先看知识图谱和摸底结果，会的不重复讲，缺的前置知识先补上，讲法按年级和基础来调。' },
      { id: 'interactive', index: '02', title: '讲练结合的互动课', copy: '语音讲解配合动手互动和随堂练习，一页一页往下学，手机、平板都能上课。' },
      { id: 'verified', index: '03', title: '学会了才算过关', copy: '学完用自己的话讲给 AI 听，AI 验收后再由老师核验，通过的知识点会点亮你的学习宇宙。' }
    ],
    steps: [
      { id: 'assessment', title: '做一次摸底测评', copy: '按年级和学科出题，首次免费，做完得到你的知识图谱。' },
      { id: 'plan', title: '和老师定学习方案', copy: '添加老师聊聊学习目标，老师按你的图谱定方案：先学哪些知识点、每天学多久。' },
      { id: 'course', title: '每天按任务学课程', copy: '课程做好后出现在「学习 › 我的课程」，每天的学习任务按先后顺序排好。' },
      { id: 'acceptance', title: '讲给 AI 听，老师核验', copy: '学完做一次复述验收，老师核验通过，这个知识点才算真正学会。' }
    ]
  },

  onLoad(options = {}) {
    attachUiAssets(this)
    const libraryCourseId = String(options.libraryCourseId || '')
    this.libraryCourseId = /^[a-f0-9]{32}$/.test(libraryCourseId) ? libraryCourseId : ''
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      courseTitle: this.libraryCourseId ? courseTitleOf(options.title) : '',
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375)
    })
  },

  // 每次回到本页都重新判断：从登录、建档、会员中心回来时按钮跟着变。读过一次后不回到骨架。
  onShow() {
    attachPaymentSwitch(this)
    return this.refreshAccess()
  },

  async refreshAccess() {
    const version = this._accessVersion = (this._accessVersion || 0) + 1
    let cta = 'join'
    try {
      const access = await loadViewerAccess()
      if (access !== 'ready') cta = access
      else if (this.libraryCourseId) {
        // 会员资格以课程服务给这门课的标记为准（与首页、会员课程全部页同一份数据）
        const courses = await loadMemberCourseLibrary()
        const course = courses.find((item) => item.id === this.libraryCourseId)
        if (course && course.isMember !== false) cta = 'member'
      }
    } catch (error) {
      // 读不到会员资格时按「不是会员」给开通入口；会员中心会显示真实状态，课程服务进课时也会再校验一次
    }
    if (version === this._accessVersion) this.setData({ cta })
  },

  handleScroll(event) {
    const topbarSolid = event.detail.scrollTop > 12
    if (topbarSolid !== this.data.topbarSolid) this.setData({ topbarSolid })
  },

  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/home/index' })
  },

  handlePrimary() {
    const { cta } = this.data
    if (cta === 'guest') return openLogin()
    if (cta === 'profile') return openProfileSetup()
    if (cta === 'join') return openPaymentPage('/commerce/membership/index', 'membership')
    if (cta === 'member' && this.libraryCourseId) return wx.redirectTo({ url: `/learning/course/index?libraryCourseId=${this.libraryCourseId}` })
  },

  // 「咨询老师」：服务入口页（企业微信老师）要登录，游客先去登录
  openServiceContact() {
    if (!this.data.cta) return
    if (this.data.cta === 'guest') return openLogin()
    wx.navigateTo({ url: '/account/service-contact/index' })
  }
})
