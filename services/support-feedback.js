const { requestCourseApi } = require('./identity')
const { report } = require('../utils/support-diagnostics')
function createSubmission(category,description,includeDiagnostics) {
  return { requestId:`mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`,category,description,includeDiagnostics,diagnostics:includeDiagnostics?report():null }
}
async function uploadFeedback(submission) {
  const response = await requestCourseApi('/api/learn/feedback',{method:'POST',data:submission})
  if (response.statusCode===201 && typeof response.data.id==='string' && /^[a-f0-9-]{36}$/.test(response.data.id)) return response.data.id
  const code=response.data.error
  const error=new Error(code==='LOGIN_REQUIRED'?'登录已过期，请重新登录后再上传。':code==='FEEDBACK_RATE_LIMIT'?'反馈较频繁，请一小时后再试。':code==='ACCOUNT_UNAVAILABLE'?'当前账号暂时无法提交反馈。':'上传未成功，问题描述和日志已保留，请稍后重试。')
  error.code=code
  throw error
}
module.exports={createSubmission,uploadFeedback}
