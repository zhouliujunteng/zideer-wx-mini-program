Page({
  onPullDownRefresh() {
    const page = this.selectComponent('#growth-page')
    if (page) page.loadPage().finally(() => wx.stopPullDownRefresh())
    else wx.stopPullDownRefresh()
  }
})
