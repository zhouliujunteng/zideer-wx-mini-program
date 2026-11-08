// 会员课程在点击时就判断资格：没登录、不是会员的不进入课程页，先进「定制课程」介绍页（2026-09-30 用户要求，
// 原来是弹窗提示开通会员、游客直接跳登录）。介绍页讲清楚定制课程是什么，再按访问状态给登录 / 完善资料 / 开通会员。
// 课程服务仍在进入学习时再校验一次，这里只是提前分流，避免进页面后才被拒绝。
function openCustomCourseIntro(course) {
  const id = String(course && course.id || '')
  const query = /^[a-f0-9]{32}$/.test(id) ? `?libraryCourseId=${id}&title=${encodeURIComponent(String(course.title || '').slice(0, 40))}` : ''
  wx.navigateTo({ url: `/learning/custom-course-intro/index${query}` })
}

module.exports = { openCustomCourseIntro }
