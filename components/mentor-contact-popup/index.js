const { hasSession, loadMentorContact, downloadMentorContactQr } = require('../../services/identity')

// 「加导师妈妈微信」弹窗（2026-11-12 用户规则）：家长开了会员、导师妈妈接单后，只给下单付款的家长弹导师妈妈的加好友二维码，
// 直到导师妈妈在接单平台点「家长已添加我的微信」（或「开始服务」、后台标记）。谁该弹由课程服务判断（/api/learn/mentor-contact）。
// 五个 tab 页都放了本组件；app.js onShow 每次进入小程序挂一次 mentorContactPending，第一个出现的 tab 页查一次、弹一次。
// 没登录、读不到、导师没传二维码：都不弹，也不报错（下次进小程序再查）。
Component({
  data: { visible: false, mentorName: '', qrPath: '' },
  pageLifetimes: {
    show() { this.check() }
  },
  lifetimes: {
    attached() { this.check() }
  },
  methods: {
    async check() {
      const app = getApp()
      if (!app || !app.globalData || !app.globalData.mentorContactPending) return
      app.globalData.mentorContactPending = false
      if (!hasSession()) return
      try {
        const contact = await loadMentorContact()
        if (!contact.show) return
        const qrPath = await downloadMentorContactQr(contact.orderId)
        this.setData({ visible: true, mentorName: contact.mentorName, qrPath })
      } catch (error) {
        // 读不到就这次不弹
      }
    },
    close() { this.setData({ visible: false }) },
    preview() {
      if (this.data.qrPath) wx.previewImage({ urls: [this.data.qrPath], current: this.data.qrPath, showmenu: true })
    },
    stopTap() {}
  }
})
