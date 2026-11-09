const { loadCurrentLearningCheckin } = require('./identity')
const { buildStreakSummary } = require('./checkin-model')

// 学习连胜（每日学习打卡）的共享状态：四个 tab 页顶栏的火苗入口、「我的」页的连胜卡片、
// 学习页的「连续学习」和打卡页读到的是同一份打卡数据。任何一处读到新数据都经 publishCheckin 写进来，
// 订阅者（components/streak-entry、components/streak-card）当场同步，所以一处点亮、处处点亮。
//
// 只存在内存里（本次启动内有效），不落盘：换账号登录后缓存按登录凭证作废，跨过零点（北京时间）后按日期作废，
// 作废后各入口回到骨架、重新读取，不会把别人的、昨天的点亮状态先显示出来。

const TOKEN_KEY = 'zion_runtime_token'
// 页面切换很频繁：10 秒内读过就直接用，不重复请求。
const FRESH_MS = 10 * 1000
// 读取请求自带 10 秒超时；万一一直没有结果，过了这个时间就不再等它，重新发一个。
const STALE_REQUEST_MS = 15 * 1000

let snapshot = null
let failure = null
let inFlight = null
let inFlightAt = 0
const listeners = []

function currentToken() {
  try { return String(wx.getStorageSync(TOKEN_KEY) || '') } catch (error) { return '' }
}

// 北京时间的今天（YYYY-MM-DD），与后端打卡流程的日期口径一致。
function beijingToday(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// 跨天按本机时钟判断（读到时记下本机眼里的日期），本机时钟不准也不会卡在骨架。
function usable(entry) {
  return Boolean(entry && entry.token === currentToken() && entry.day === beijingToday())
}

// 当前状态：{ status: 'loading' | 'ready' | 'failed' | 'guest' | 'profile', summary }。
// loading 只出现在本次启动（或换账号、跨天后）第一次读到之前，入口据此画骨架。
// guest：没登录；profile：已登录、还没完善学习资料（2026-09-27 起未登录也能浏览），入口据此引导去登录 / 去完善。
function getStreakState() {
  if (usable(snapshot)) return { status: 'ready', summary: snapshot.summary }
  if (!currentToken()) return { status: 'guest', summary: null }
  if (failure && failure.token === currentToken()) return { status: failure.profileRequired ? 'profile' : 'failed', summary: null, error: failure.message }
  return { status: 'loading', summary: null }
}

function notify() {
  const state = getStreakState()
  listeners.slice().forEach((listener) => {
    try { listener(state) } catch (error) {}
  })
}

function subscribeStreak(listener) {
  listeners.push(listener)
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  }
}

// 别处（打卡页、学习页）已经读到了打卡数据：写进共享状态并通知所有入口。数据不完整时忽略。
function publishCheckin(checkin) {
  let summary
  try { summary = buildStreakSummary(checkin || {}) } catch (error) { return }
  // 读得慢的旧请求不能把刚点亮的状态盖回去：同一天里只接受「更亮」或更新的日期。
  const previous = usable(snapshot) ? snapshot.summary : null
  if (previous && previous.today === summary.today && previous.lit && !summary.lit) return
  snapshot = { token: currentToken(), day: beijingToday(), checkin, summary, fetchedAt: Date.now() }
  failure = null
  notify()
}

// 读取打卡数据（原始结构，同 identity.loadCurrentLearningCheckin）：并发调用共用一个请求，
// maxAge 毫秒内读过就直接返回上次的结果。读到后同步给所有入口；读取失败时已有数据保持不变，错误抛给调用方。
// 学习页也经这里读（services/live-tab-service.js），与顶栏入口的读取合并成一个请求。
function loadCheckin({ maxAge = FRESH_MS } = {}) {
  // 游客没有打卡数据可读，不发请求
  if (!currentToken()) {
    const error = new Error('请先登录后查看学习打卡。')
    error.code = 'AUTH_REQUIRED'
    return Promise.reject(error)
  }
  if (usable(snapshot) && Date.now() - snapshot.fetchedAt < maxAge) return Promise.resolve(snapshot.checkin)
  if (inFlight && Date.now() - inFlightAt < STALE_REQUEST_MS) return inFlight
  const token = currentToken()
  const request = loadCurrentLearningCheckin().then((checkin) => {
    if (token === currentToken()) publishCheckin(checkin)
    return checkin
  }, (error) => {
    if (token === currentToken() && !usable(snapshot)) {
      failure = { token, message: error && error.message || '学习打卡暂时无法读取', profileRequired: Boolean(error && error.code === 'PROFILE_REQUIRED') }
      notify()
    }
    throw error
  })
  inFlight = request
  inFlightAt = Date.now()
  const settle = () => { if (inFlight === request) inFlight = null }
  request.then(settle, settle)
  return request
}

// 入口组件用：刷新后返回当前状态，不抛错。
function refreshStreak(options) {
  return loadCheckin(options).then(getStreakState, getStreakState)
}

module.exports = { getStreakState, subscribeStreak, publishCheckin, loadCheckin, refreshStreak, beijingToday }
