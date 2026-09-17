const config = require('../../config/index')
// Business tests use an already verified account. Phone-auth tests cover this boundary separately.
module.exports = function respondToPhoneStatus(options) {
  if (!String(options.data && options.data.query).includes(config.ACTION_FLOWS.GET_PHONE_LOGIN_STATE.id)) return false
  options.success({statusCode:200,data:{data:{result:{authenticated:true,phoneVerified:true}}}})
  return true
}
