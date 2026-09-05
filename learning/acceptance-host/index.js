Page({
  data: { launchUrl: '', failed: false },

  onLoad(options) {
    const launchUrl = decodeURIComponent(String(options.launchUrl || ''))
    if (!/^https:\/\//i.test(launchUrl)) {
      this.setData({ failed: true })
      return
    }
    this.setData({ launchUrl })
  },

  goBack() {
    wx.navigateBack()
  }
})
