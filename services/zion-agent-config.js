/**
 * Zion AI Agent 调试接入配置
 *
 * 客户交付/更换项目时，通常只需要修改下面 3 个字段：
 * 1. projectExId：Zion 项目外部 ID；
 * 2. agentConfigId：AI Agent 的 configId；
 * 3. inputArgKey：该 Agent 输入参数的 argKey（不是显示名称）。
 *
 * 这是主包公共配置，因为 app.js 需要在小程序 onLaunch 阶段初始化登录。
 * Admin Bearer Token、API Key 等敏感信息严禁放在这里或任何客户端代码中。
 */
const ZION_AGENT_CONFIG = Object.freeze({
  projectExId: 'PO76RBe9zVY',
  agentConfigId: 'mu2547xm',
  inputArgKey: 'mu254h5p',

  // Runtime GraphQL 的公共地址。项目 ID 会自动拼接到 path 中。
  runtimeHost: 'https://zion-app.functorz.com',

  // 静默登录完成后，用户 JWT 会写入同名 storage key；在明确关闭所有登录
  // transport 的离线调试配置下，才会按游客身份请求。不要保存管理员 Token。
  authStorageKey: 'zhilu-zion-jwt',
  accountIdStorageKey: 'zhilu-zion-account-id',

  // 正式项目可直接调用 Zion Runtime 的 loginWithWechatMiniApp 完成 wx.login code 换票；
  // 如果客户已有自己的鉴权服务，可填写该地址覆盖默认 Runtime 登录。
  // 自定义接口必须返回 { token, accountId }（或等价字段）。
  silentLoginEndpoint: '',
  // 当前测试号暂不走 Zion 微信绑定，启动和对话按游客调试；正式项目配置完成后改为 true。
  useZionRuntimeWechatLogin: false,
  // 当前页面历史仅用于展示交互，改为 'zion' 后才查询真实 account_id 历史。
  allowAnonymousDebugFallback: true,
  historyMode: 'mock',
  historyLimit: 30,

  // 当前示例使用 HTTP 轮询，兼容没有 WebSocket 的开发环境。
  pollIntervalMs: 900,
  timeoutMs: 60000,

  // E04 调试默认必须展示真实 Zion 结果；失败直接显示错误，避免误把本地文本当成 AI 回复。
  enabled: true,
  fallbackToMock: false
})

function getGraphqlEndpoint(config = ZION_AGENT_CONFIG) {
  return `${config.runtimeHost}/zero/${config.projectExId}/api/graphql-v2`
}

module.exports = { ZION_AGENT_CONFIG, getGraphqlEndpoint }
