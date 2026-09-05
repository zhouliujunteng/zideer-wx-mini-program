const { createCourseLaunchUrl } = require('../../services/identity')

Page({
  data: {
    loading: true,
    failed: false,
    launchUrl: ''
  },

  onLoad(options) {
    this.courseInstanceId = String(options.courseInstanceId || '')
    this.loadCourse()
  },

  async loadCourse() {
    this.setData({ loading: true, failed: false, launchUrl: '' })
    try {
      const launchUrl = await createCourseLaunchUrl(this.courseInstanceId)
      this.setData({ launchUrl })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '课程暂时无法进入', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  retry() {
    this.loadCourse()
  },

  goBack() {
    wx.navigateBack()
  }
})
