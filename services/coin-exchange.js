// 金币兑换现金（100 金币 = 1 元，转到本人微信零钱）。
// 服务端：课程服务 /api/learn/coin-exchange（OpenMAIC-sync lib/coin-exchange/service.ts）调微信支付「商家转账」，
// 金币冻结、扣减、退回在 Zion「金币兑换记账」里做。这里只负责发请求和拉起微信的确认收款页。
const { requestCourseApi } = require('./identity')

const PATH = '/api/learn/coin-exchange'

// 服务端错误码 → 给学生看的话
const MESSAGES = {
  LOGIN_REQUIRED: '登录已过期，请重新登录后再兑换。',
  NO_WECHAT: '请用微信登录后再兑换，钱会转到你登录的这个微信。',
  NOT_INITIALIZED: '请先完成学习档案，再来兑换金币。',
  EXCHANGE_CLOSED: '金币兑换暂未开放，请稍后再来。',
  EXCHANGE_UNAVAILABLE: '兑换服务暂时不可用，请稍后再试。',
  TRANSFER_REJECTED: '这次没能转账，金币已退回，请稍后再试。',
  EXCHANGE_PAUSED: '兑换现金暂时维护中，你的金币都在，请稍后再来。',
  AMOUNT_INVALID: '兑换金额不对，请重新选择。',
  BALANCE_INSUFFICIENT: '金币不够了，请刷新后重新选择金额。',
  DAILY_LIMIT: '今天的兑换次数用完了，明天再来吧。',
  STUDENT_INACTIVE: '当前账号暂时不能兑换，请联系老师。',
  IDENTITY_MISMATCH: '当前账号暂时不能兑换，请联系老师。',
  EXCHANGE_NOT_FOUND: '没有找到这笔兑换，请刷新后查看。',
  TRY_LATER: '操作太频繁了，请稍后再试。'
}

function exchangeError(response) {
  const code = response && response.data && response.data.code || ''
  const error = new Error(MESSAGES[code] || MESSAGES.EXCHANGE_UNAVAILABLE)
  error.code = code || 'EXCHANGE_UNAVAILABLE'
  return error
}

async function call(method, data) {
  const response = await requestCourseApi(PATH, { method, data })
  if (response.statusCode !== 200 || !response.data || response.data.success !== true) throw exchangeError(response)
  return response.data
}

// 兑换规则、余额、在途的一笔（服务端会顺手按微信状态推进在途的单）
function loadCoinExchange() { return call('GET') }
// 发起兑换：回 { exchange, confirm, resumed }；confirm 为空表示还在处理中
function startCoinExchange(coins) { return call('POST', { operation: 'start', coins }) }
function resumeCoinExchange(requestNo) { return call('POST', { operation: 'resume', requestNo }) }
function syncCoinExchange(requestNo) { return call('POST', { operation: 'sync', requestNo }) }
function cancelCoinExchange(requestNo) { return call('POST', { operation: 'cancel', requestNo }) }

// 拉起微信确认收款页。回 'confirmed' | 'cancelled'；微信版本太低或调用失败时抛错。
function confirmTransfer(confirm) {
  return new Promise((resolve, reject) => {
    if (!confirm || !confirm.package) return reject(new Error('收款信息不完整，请稍后在兑换记录里继续确认。'))
    if (!wx.canIUse || !wx.canIUse('requestMerchantTransfer')) {
      const error = new Error('当前微信版本太低，请升级微信后再兑换。')
      error.code = 'UNSUPPORTED'
      return reject(error)
    }
    wx.requestMerchantTransfer({
      mchId: confirm.mchId,
      appId: confirm.appId,
      package: confirm.package,
      success: () => resolve('confirmed'),
      fail: (error) => {
        if (/cancel/i.test(String(error && error.errMsg || ''))) return resolve('cancelled')
        reject(new Error('没能打开微信收款页，请稍后在兑换记录里继续确认。'))
      }
    })
  })
}

module.exports = {
  loadCoinExchange,
  startCoinExchange,
  resumeCoinExchange,
  syncCoinExchange,
  cancelCoinExchange,
  confirmTransfer
}
