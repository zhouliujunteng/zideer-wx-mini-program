const {
  createAcceptanceLaunchUrl,
  createCurrentFeynmanAcceptance,
  uploadCurrentAcceptanceAudio
} = require('../../services/identity')

function requestRecordPermission() {
  return new Promise((resolve, reject) => {
    wx.getSetting({
      success: (settings) => {
        if (settings.authSetting['scope.record']) {
          resolve()
          return
        }
        wx.authorize({ scope: 'scope.record', success: resolve, fail: reject })
      },
      fail: reject
    })
  })
}

Page({
  data: {
    courseInstanceId: '',
    acceptanceId: '',
    preparing: false,
    recording: false,
    uploading: false,
    discarding: false,
    unavailable: false
  },

  onLoad(options) {
    const courseInstanceId = String(options.courseInstanceId || '')
    this.setData({ courseInstanceId, unavailable: !/^\d+$/.test(courseInstanceId) })
  },

  async prepareAcceptance() {
    if (this.data.preparing || this.data.unavailable) return
    this.setData({ preparing: true })
    try {
      await requestRecordPermission()
      const acceptance = await createCurrentFeynmanAcceptance(this.data.courseInstanceId)
      this.setData({ acceptanceId: acceptance.acceptanceId })
    } catch (error) {
      const denied = /authorize|auth|record|录音/.test(String(error && error.errMsg || error && error.message || ''))
      wx.showToast({ title: denied ? '需要麦克风权限才能开始验收' : (error.message || '暂时无法开始验收'), icon: 'none' })
    } finally {
      this.setData({ preparing: false })
    }
  },

  startRecording() {
    if (!this.data.acceptanceId || this.data.recording || this.data.uploading) return
    const recorder = wx.getRecorderManager()
    recorder.onStop((result) => this.handleRecordingStop(result))
    recorder.onError((error) => {
      this.setData({ recording: false })
      wx.showToast({ title: error.errMsg || '录音失败，请重试。', icon: 'none' })
    })
    this.setData({ recording: true, discarding: false })
    recorder.start({ duration: 10 * 60 * 1000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'mp3' })
  },

  stopRecording() {
    if (this.data.recording) wx.getRecorderManager().stop()
  },

  async handleRecordingStop(result) {
    if (this.data.discarding) return
    this.setData({ recording: false, uploading: true })
    try {
      await uploadCurrentAcceptanceAudio(
        this.data.acceptanceId,
        result && result.tempFilePath,
        Number(result && result.duration || 0)
      )
      const launchUrl = await createAcceptanceLaunchUrl(this.data.courseInstanceId, this.data.acceptanceId)
      wx.navigateTo({
        url: `/learning/acceptance-host/index?launchUrl=${encodeURIComponent(launchUrl)}`
      })
    } catch (error) {
      wx.showToast({ title: error.message || '录音上传失败，请重新录制。', icon: 'none' })
    } finally {
      this.setData({ uploading: false })
    }
  },

  onUnload() {
    if (this.data.recording) {
      this.setData({ discarding: true })
      wx.getRecorderManager().stop()
    }
  },

  goBack() {
    wx.navigateBack()
  }
})
