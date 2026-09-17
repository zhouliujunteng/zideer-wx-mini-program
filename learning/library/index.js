const { loadMemberCourseLibrary } = require('../../services/identity')

Page({
  data: { loading: true, error: '', membershipRequired: false, courses: [], visibleCourses: [], search: '' },
  onShow() { this.loadCourses() },
  onHide() { this._requestVersion = (this._requestVersion || 0) + 1 },
  onUnload() { this._requestVersion = (this._requestVersion || 0) + 1 },
  async loadCourses() {
    const version = this._requestVersion = (this._requestVersion || 0) + 1
    this.setData({ loading: true, error: '', membershipRequired: false, courses: [], visibleCourses: [] })
    try {
      const courses = await loadMemberCourseLibrary()
      if (version !== this._requestVersion) return
      this.setData({ courses })
      this.filterCourses()
    } catch (error) {
      if (version === this._requestVersion) this.setData({ error: error.message || '课程库暂时无法读取。', membershipRequired: error.code === 'MEMBERSHIP_REQUIRED' })
    } finally {
      if (version === this._requestVersion) this.setData({ loading: false })
    }
  },
  searchCourses(event) {
    this.setData({ search: String(event.detail.value || '') })
    this.filterCourses()
  },
  openMembership() { wx.navigateTo({ url: '/commerce/membership/index' }) },
  filterCourses() {
    const search = this.data.search.trim().toLowerCase()
    this.setData({ visibleCourses: this.data.courses.filter((course) =>
      `${course.title} ${course.subject} ${course.grade}`.toLowerCase().includes(search)) })
  },
  openCourse(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!this.data.courses.some((course) => course.id === id)) return
    wx.navigateTo({ url: `/learning/course/index?libraryCourseId=${id}` })
  }
})
