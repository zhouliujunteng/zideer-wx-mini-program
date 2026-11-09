const { readAccountType } = require('../utils/account-role')

// 底栏（2026-09-25 起用自定义底栏）：家长账号没有「目标」（原「图谱」），只有四项（用户规则）；学生五项与原生底栏一致。
// 原生 tabBar 不能按账号删掉一项，所以 app.json 开了 custom。图标沿用原生底栏那套包内 PNG
// （底栏要在第一帧就画出来，不能等后端素材；这 10 张图本来就因原生 tabBar 留在包内）。
const TABS = [
  { route: 'pages/home/index', text: '首页', icon: '/assets/tabbar/home.png', activeIcon: '/assets/tabbar/home-active.png' },
  { route: 'pages/learning/index', text: '学习', icon: '/assets/tabbar/learning.png', activeIcon: '/assets/tabbar/learning-active.png' },
  { route: 'pages/knowledge-universe/index', text: '宇宙', icon: '/assets/tabbar/universe.png', activeIcon: '/assets/tabbar/universe-active.png' },
  // 2026-10-10 起「图谱」换成「目标」（知识图谱挪到「我的 › 知鹿服务」）
  { route: 'pages/goal/index', text: '目标', icon: '/assets/tabbar/goal.png', activeIcon: '/assets/tabbar/goal-active.png', studentOnly: true },
  { route: 'pages/me/index', text: '我的', icon: '/assets/tabbar/me.png', activeIcon: '/assets/tabbar/me-active.png' }
]

function tabsFor(accountType) {
  return accountType === 'guardian' ? TABS.filter((tab) => !tab.studentOnly) : TABS
}

function currentRoute() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  const page = pages[pages.length - 1]
  return page && page.route ? String(page.route) : ''
}

Component({
  data: {
    tabs: tabsFor(readAccountType()),
    selected: '',
    // 页面里的整屏弹窗（如首页「设为星标」引导）打开时收起底栏，遮罩才盖得住整屏
    hidden: false
  },

  lifetimes: {
    attached() { this.refresh() }
  },

  // 每次回到 tab 页都重读身份：在「身份与登录」切换身份后，已经建好的底栏也要跟着变
  pageLifetimes: {
    show() { this.refresh() }
  },

  methods: {
    refresh(route) {
      const tabs = tabsFor(readAccountType())
      const selected = route || currentRoute() || this.data.selected
      const patch = {}
      if (tabs.length !== this.data.tabs.length) patch.tabs = tabs
      if (TABS.some((tab) => tab.route === selected) && selected !== this.data.selected) patch.selected = selected
      if (Object.keys(patch).length) this.setData(patch)
    },

    handleTap(event) {
      const route = String(event.currentTarget.dataset.route || '')
      if (!route || route === this.data.selected) return
      wx.switchTab({ url: `/${route}` })
    }
  }
})
