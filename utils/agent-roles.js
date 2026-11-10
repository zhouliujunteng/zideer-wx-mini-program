// 三种代理身份要做的工作与分润（2026-11-10 用户规则，申请页、「我的代理身份」页共用）。
// 分润口径以课程服务 / 后台为准，这里只是给用户看的说明；改规则要同步改这里。
const AGENT_ROLE_INFO = [
  {
    key: 'love_mom',
    label: '爱心妈妈',
    work: '找到想给孩子报名的家庭，在小程序里输入家长的用户 ID 完成绑定。',
    reward: '绑定的家庭每开通一单 9800 会员，拿实付的 15% 佣金，付款 7 天后可结算。'
  },
  {
    key: 'mentor_mom',
    label: '导师妈妈',
    work: '在导师接单平台接单，加家长微信，陪孩子学习直到这一单的课程积分用完，每次服务后上传服务记录。',
    reward: '开始服务拿实付的 2.5%（7 天后可结算）；服务完成、平台确认后再拿 2.5%，立即可结算。'
  },
  {
    key: 'team_leader',
    label: '爱心妈妈团团长',
    work: '带领爱心妈妈团：可以自己绑定家庭，也可以替身边的人申请成为爱心妈妈，通过后自动进你的团。',
    reward: '团里爱心妈妈绑定的家庭成交，拿实付的 10% 团队服务费；自己绑定的家庭成交拿 15% 佣金 + 10% 团队服务费。均付款 7 天后可结算。'
  }
]

function roleInfo(key) {
  return AGENT_ROLE_INFO.find((item) => item.key === key) || null
}

module.exports = { AGENT_ROLE_INFO, roleInfo }
