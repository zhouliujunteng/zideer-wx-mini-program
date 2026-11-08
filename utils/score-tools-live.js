// 首页 AI 提分工具里已经上线的（与课程服务 lib/score-tools/config.ts 的 LIVE_SCORE_TOOLS 一致）；其余入口仍提示「即将上线」。
// 单独放一个没有依赖的文件：首页（主包）只要这一份清单，不必引入整个提分工具服务。
const LIVE_SCORE_TOOLS = ['question-review', 'error-diagnosis', 'error-variation']

module.exports = { LIVE_SCORE_TOOLS }
