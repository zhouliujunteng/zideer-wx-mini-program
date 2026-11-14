const { loadCurrentFamilyRelations } = require('./identity')

// 已绑定家长的孩子不能自己付款（2026-11-14 用户规则）：会员与积分记在家长账号、全家共用，
// 孩子自己付的话代理没有分润、积分也进不了家庭账户，所以由家长在自己的小程序里开通。
// 这里只看「当前账号名下有没有生效的家长」；家长账号、没绑家长的学生照常付款。读不到时抛错，由页面显示重试，不放行也不误拦。
const GUARDIAN_PAYS_MESSAGE = '你已绑定家长，会员由家长开通，全家共用。请家长在自己的知鹿学习小程序「我的」页开通会员。'

async function guardianPays() {
  const family = await loadCurrentFamilyRelations()
  return !!(family && family.guardians && family.guardians.length)
}

function guardianPaysError() {
  const error = new Error(GUARDIAN_PAYS_MESSAGE)
  error.code = 'GUARDIAN_PAYS'
  error.paymentNotStarted = true
  return error
}

module.exports = { guardianPays, guardianPaysError, GUARDIAN_PAYS_MESSAGE }
