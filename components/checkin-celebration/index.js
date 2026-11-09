const { attachUiAssets } = require('../../services/ui-assets')

// 「今日打卡完成」弹窗（2026-09-25 规则：学完一节课或费曼验收通过算一天）。
// 页面把课程服务回包里的 checkin 交给 notice，一天只会带一次；学习页（网页）里有一份同样的弹窗
// （课程服务 components/classroom/LearnerCheckinNotice.tsx），小程序原生页（如费曼验收）用这一份。
// notice = { status: 'checked_in' | 'pending', title, rewardCoins, streakDays, cards: [{ cardType, title, count }] }
const CARD_NAMES = { freeze: '冻结卡', revive: '复活卡' }

function whole(value) {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}

Component({
  properties: {
    notice: { type: Object, value: null },
    closeLabel: { type: String, value: '继续' }
  },
  data: { view: null },
  lifetimes: {
    attached() {
      attachUiAssets(this)
    }
  },
  observers: {
    notice(notice) {
      if (!notice || !['checked_in', 'pending'].includes(notice.status)) {
        this.setData({ view: null })
        return
      }
      const title = String(notice.title || '').trim()
      const acceptance = notice.sourceKind === 'acceptance_passed'
      const review = notice.sourceKind === 'review_completed'
      this.setData({
        view: {
          confirmed: notice.status === 'checked_in',
          subtitle: review
            ? (title ? `复习完《${title}》，今天的学习火苗点亮了` : '完成一次复习，今天的学习火苗点亮了')
            : acceptance
            ? (title ? `《${title}》费曼验收通过，今天的学习火苗点亮了` : '费曼验收通过，今天的学习火苗点亮了')
            : (title ? `学完《${title}》，今天的学习火苗点亮了` : '学完一节课，今天的学习火苗点亮了'),
          streakDays: whole(notice.streakDays),
          rewardCoins: whole(notice.rewardCoins),
          cards: (Array.isArray(notice.cards) ? notice.cards : [])
            .filter((card) => card && CARD_NAMES[card.cardType] && whole(card.count))
            .map((card) => ({
              type: card.cardType,
              title: String(card.title || '').trim() || CARD_NAMES[card.cardType],
              count: whole(card.count),
              iconSrc: `/learning/assets/check-in/card-${card.cardType}.svg`
            }))
        }
      })
    }
  },
  methods: {
    noop() {},
    handleClose() {
      this.setData({ view: null })
      this.triggerEvent('close')
    },
    handleView() {
      this.setData({ view: null })
      this.triggerEvent('close')
      wx.navigateTo({ url: '/learning/check-in/index' })
    }
  }
})
