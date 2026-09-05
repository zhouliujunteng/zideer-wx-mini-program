const { loadCurrentCreditAccount } = require('../../services/identity')

Page({
  data: { loading: true, failed: false, account: null, batches: [], ledger: [] },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentCreditAccount()
      this.setData({ account: data.account, batches: data.batches, ledger: data.ledger })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '积分账户加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
