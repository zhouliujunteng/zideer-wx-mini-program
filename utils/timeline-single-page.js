// 从朋友圈点开进入的「单页模式」（场景值 1154）：不能登录、不能跳页，底部由微信固定放「前往小程序」。
// 被分享出去的页面要自己识别这种打开方式，只放不依赖登录的内容。
const TIMELINE_SINGLE_PAGE_SCENE = 1154

function isTimelineSinglePage() {
  try {
    const launch = typeof wx !== 'undefined' && wx.getLaunchOptionsSync ? wx.getLaunchOptionsSync() : null
    return Boolean(launch && Number(launch.scene) === TIMELINE_SINGLE_PAGE_SCENE)
  } catch (error) {
    return false
  }
}

module.exports = { isTimelineSinglePage }
