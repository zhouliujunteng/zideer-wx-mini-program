function isEnterpriseWechatCorpId(value) {
  return /^ww[0-9A-Za-z]{16}$/.test(String(value || '').trim())
}

function isEnterpriseWechatServiceUrl(value) {
  const url = String(value || '').trim()
  return url.length <= 2048
    && /^https:\/\/work\.weixin\.qq\.com\/kfid\/[0-9A-Za-z_-]+(?:[?#][^\s]*)?$/.test(url)
}

function isEnterpriseWechatContact(contact) {
  return Boolean(contact
    && isEnterpriseWechatCorpId(contact.corpId)
    && isEnterpriseWechatServiceUrl(contact.targetRef))
}

function customerServiceErrorMessage(error) {
  if (error && error.code === 'INVALID_CUSTOMER_SERVICE_CONTACT') {
    return '该服务入口已失效，请刷新后重试'
  }
  if (error && error.code === 'CUSTOMER_SERVICE_UNSUPPORTED') {
    return '当前微信版本不支持企微客服，请升级后重试'
  }
  return '企微客服未打开，请稍后重试'
}

function openCustomerServiceChat(contact) {
  if (!isEnterpriseWechatContact(contact)) {
    return Promise.reject(Object.assign(new Error('Invalid enterprise WeChat customer-service contact'), {
      code: 'INVALID_CUSTOMER_SERVICE_CONTACT'
    }))
  }
  if (typeof wx === 'undefined' || typeof wx.openCustomerServiceChat !== 'function') {
    return Promise.reject(Object.assign(new Error('wx.openCustomerServiceChat is unavailable'), {
      code: 'CUSTOMER_SERVICE_UNSUPPORTED'
    }))
  }

  return new Promise((resolve, reject) => {
    wx.openCustomerServiceChat({
      corpId: String(contact.corpId).trim(),
      extInfo: { url: String(contact.targetRef).trim() },
      success: resolve,
      fail: reject
    })
  })
}

module.exports = {
  isEnterpriseWechatCorpId,
  isEnterpriseWechatServiceUrl,
  isEnterpriseWechatContact,
  customerServiceErrorMessage,
  openCustomerServiceChat
}
