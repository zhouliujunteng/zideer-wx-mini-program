// 报告与分享共用。缺失记录不能用 0 或平均用时替代。
function duration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '未记录'
  const n = Math.round(seconds)
  if (!n) return '不足1秒'
  return n < 60 ? `${n}秒` : `${Math.floor(n / 60)}分${n % 60 ? `${n % 60}秒` : ''}`
}
function timingView(item) {
  const previous = item.previous
  const method = item.timingMethod
  return {
    ...item,
    timingLabel: item.unreached ? '未作答' : duration(item.secondsUsed),
    timingNote: method === 'legacy-elapsed' ? '历史计时' : method === 'mixed' ? '混合计时' : '',
    previousTimingLabel: previous ? `上次 ${duration(previous.secondsUsed)} · ${previous.correct ? '答对' : '答错'}${previous.timingMethod !== method ? '（计时口径不同）' : ''}` : '',
    resultLabel: item.correct ? '答对' : item.selected ? '答错' : item.unreached ? '未作答' : '跳过'
  }
}
const timingNotice = '用时按秒记录，累计本题提交及修改前的停留时间；新版暂停后台计时。历史计时可能含离开页面的时间。未记录不作估算，用时需结合对错看。'
module.exports = { duration, timingView, timingNotice }
