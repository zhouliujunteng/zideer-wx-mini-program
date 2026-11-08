const {
  createAcceptanceLaunchUrl,
  createCurrentFeynmanAcceptance,
  uploadCurrentAcceptanceAudio
} = require('../../services/identity')
const { ensureScope, guideOnFailure } = require('../../utils/permission-guide')

// 拒过一次后 wx.authorize 会直接失败、不再弹框，所以被拒时要引导去设置页重新打开
const MICROPHONE_GUIDE = {
  scope: 'scope.record',
  title: '需要麦克风权限',
  content: '费曼验收要录下你的讲解，请在设置里打开「麦克风」后再开始。'
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
      // 没授权时弹窗已经说明过原因，这里直接停下
      if (!await ensureScope('scope.record', MICROPHONE_GUIDE)) return
      const acceptance = await createCurrentFeynmanAcceptance(this.data.courseInstanceId)
      this.setData({ acceptanceId: acceptance.acceptanceId })
    } catch (error) {
      wx.showToast({ title: error.message || '暂时无法开始验收', icon: 'none' })
    } finally {
      this.setData({ preparing: false })
    }
  },

  startRecording() {
    if (!this.data.acceptanceId || this.data.recording || this.data.uploading) return
    const recorder = wx.getRecorderManager()
    // RecorderManager 是全局单例、监听是覆盖式的：onStart 也换成本页的，
    // 免得别处留下的监听（如共享录音桥）把这次录音当成它自己的停掉
    if (recorder.onStart) recorder.onStart(() => {})
    recorder.onStop((result) => this.handleRecordingStop(result))
    recorder.onError((error) => {
      this.setData({ recording: false })
      guideOnFailure(error, MICROPHONE_GUIDE).then((kind) => {
        if (kind === 'other') wx.showToast({ title: '录音失败，请重试。', icon: 'none' })
      })
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
