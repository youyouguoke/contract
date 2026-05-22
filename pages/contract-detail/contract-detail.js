const { getContractById, updateContract } = require('../../utils/cloud-db');
const { getStatusInfo, formatDate, showToast } = require('../../utils/util');
const app = getApp();

Page({
  data: {
    contract: {
      title: '',
      templateName: '',
      initiator: { name: '' },
      signers: [],
      status: '',
      tags: [],
    },
    statusInfo: {},
    statusIcon: '',
    statusDesc: '',
    createdTime: '',
    showActions: true,
    canShare: false,
    canDownload: false,
    downloading: false,
    myAlreadySigned: false,
    isInitiator: false,
  },

  onLoad(options) {
    const { id, from } = options;
    this.contractId = id;
    this.fromShare = from === 'share';
    this._loaded = false;
    this.loadContract(id);
  },

  onShow() {
    if (this._loaded && this.contractId) {
      this.loadContract(this.contractId);
    }
  },

  async loadContract(id) {
    if (!id) return;
    try {
      await app.loginPromise;
      const contract = await getContractById(id);

      if (!contract) {
        showToast('合约不存在');
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      const statusInfo = getStatusInfo(contract.status);
      const iconMap = {
        draft: '📝',
        pending: '⏳',
        signing: '✍️',
        completed: '✅',
        rejected: '❌',
        expired: '⏰',
        revoked: '↩️',
      };

      const descMap = {
        draft: '合约尚未发起，可继续编辑',
        pending: '等待签署方确认并签署',
        signing: '部分签署方已完成签署',
        completed: '所有签署方已完成签署',
        rejected: '签署方已拒绝签署',
        expired: '合约已超过签署期限',
        revoked: '发起方已撤回合约',
      };

      const canShare = ['pending', 'signing'].includes(contract.status);
      const canDownload = ['pending', 'signing', 'completed'].includes(contract.status);
      const fromShare = this.fromShare || false;

      // 判断当前用户是否已签署
      const userInfo = app.globalData.userInfo || {};
      const mySigner = (contract.signers || []).find(s =>
        (userInfo.phone && s.phone === userInfo.phone) ||
        (userInfo.name && s.name === userInfo.name)
      );
      const myAlreadySigned = mySigner && mySigner.status === 'signed';

      // 是否还有待签署的签署方（用于非发起方显示签约按钮）
      const hasPendingSigner = (contract.signers || []).some(s => s.status === 'pending');

      // 判断当前用户是否为发起方（使用云函数在服务端通过 _openid 判断的结果）
      const isInitiator = !!contract._isInitiator;

      // 将发起方和签署方中的"微信用户"/"我"替换为手机号或实际名称
      const displayName = (name, phone) => {
        if (name && name !== '微信用户' && name !== '我') return name;
        if (phone) return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
        return '未设置姓名';
      };
      if (contract.initiator) {
        contract.initiator.name = displayName(contract.initiator.name, contract.initiator.phone || (isInitiator ? userInfo.phone : ''));
      }
      (contract.signers || []).forEach(s => {
        if (s.fillMode === 'signer' && !s.name && s.status === 'pending') return; // 对方填写模式且未填，保留空
        s.name = displayName(s.name, s.phone);
      });

      // 解析合约字段（非文档模板）
      const fields = contract.formData && contract.formData.fields || {};
      const signers = contract.signers || [];
      const partyA = signers.find(s => s.role === '甲方');
      const partyB = signers.find(s => s.role === '乙方');
      const partyAName = fields['甲方名称'] || (partyA ? partyA.name : '') || '';
      const partyBName = (partyB ? partyB.name : '') || '';
      const contractFields = Object.keys(fields)
        .filter(key => key !== '甲方名称' && fields[key] !== undefined && fields[key] !== '')
        .map(key => ({ label: key, value: fields[key] }));

      this.setData({
        contract,
        statusInfo,
        statusIcon: iconMap[contract.status] || '📄',
        statusDesc: descMap[contract.status] || '',
        createdTime: formatDate(contract.createdAt, 'YYYY-MM-DD HH:mm'),
        showActions: ['draft', 'pending', 'signing', 'completed', 'revoked'].includes(contract.status),
        canShare,
        canDownload,
        fromShare,
        contractFields,
        partyAName,
        partyBName,
        myAlreadySigned,
        hasPendingSigner,
        isInitiator,
      });
      this._loaded = true;
    } catch (e) {
      console.error('Load contract failed', e);
      showToast('加载失败');
    }
  },

  goSign() {
    app.requireLogin(() => {
      const id = this.data.contract._id || this.data.contract.id;
      const from = this.fromShare ? '&from=share' : '';
      wx.navigateTo({ url: `/pages/sign/sign?contractId=${id}${from}` });
    });
  },

  editContract() {
    const contract = this.data.contract;
    const id = contract._id || contract.id;
    wx.navigateTo({ url: `/pages/create-contract/create-contract?templateId=${contract.templateId}&contractId=${id}` });
  },

  deleteContract() {
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确认删除此草稿？',
      confirmColor: '#FA3534',
      success: async (res) => {
        if (res.confirm) {
          try {
            const id = this.data.contract._id || this.data.contract.id;
            await require('../../utils/cloud-db').removeContract(id);
            showToast('已删除');
            setTimeout(() => wx.navigateBack(), 1500);
          } catch (e) {
            showToast('删除失败');
          }
        }
      },
    });
  },

  shareToSigner() {},

  sendContract() {
    wx.showModal({
      title: '确认发起签约',
      content: '发起后将通知签署方进行签署',
      success: (res) => {
        if (res.confirm) {
          this.updateContractStatus('pending');
          showToast('签约已发起');
        }
      },
    });
  },

  revokeContract() {
    wx.showModal({
      title: '确认撤回',
      content: '撤回后签署方将无法继续签署',
      confirmColor: '#FA3534',
      success: (res) => {
        if (res.confirm) {
          this.updateContractStatus('revoked');
          showToast('合约已撤回');
          setTimeout(() => wx.navigateBack(), 1500);
        }
      },
    });
  },

  resendContract() {
    wx.showModal({
      title: '确认重新发起',
      content: '将重置签署方状态并重新发起签约',
      success: async (res) => {
        if (res.confirm) {
          try {
            const contract = this.data.contract;
            const id = contract._id || contract.id;
            const signers = (contract.signers || []).map(s => {
              if (s.status === 'signed' && s.signatureFileID) {
                return s;
              }
              return { ...s, status: 'pending', signedAt: null, signatureFileID: null, stampFileID: null };
            });
            await updateContract(id, {
              status: 'pending',
              signers,
              updatedAt: new Date().toISOString(),
            });
            showToast('签约已重新发起');
            this.loadContract(id);
          } catch (e) {
            console.error('Resend contract failed', e);
            showToast('操作失败');
          }
        }
      },
    });
  },

  async updateContractStatus(status) {
    try {
      const id = this.data.contract._id || this.data.contract.id;
      await updateContract(id, {
        status,
        updatedAt: new Date().toISOString(),
      });
      this.loadContract(id);
    } catch (e) {
      console.error('Update contract failed', e);
      showToast('操作失败');
    }
  },

  async downloadPDF() {
    if (this.data.downloading) return;
    this.setData({ downloading: true });

    const contract = this.data.contract;
    const contractId = contract._id || contract.id;

    wx.showLoading({ title: '正在生成文件...', mask: true });

    try {
      // 每次重新生成 PDF（确保包含最新签署信息）
      let fileID = null;
      const res = await wx.cloud.callFunction({
        name: 'generate-pdf',
        data: { contractId },
      });
      const result = res.result;
      if (!result || result.code !== 0 || !result.data) {
        throw new Error(result && result.message ? result.message : '文件生成失败');
      }
      fileID = result.data.fileID;

      // Download to temp path
      const downloadRes = await wx.cloud.downloadFile({ fileID });
      wx.hideLoading();

      wx.openDocument({
        filePath: downloadRes.tempFilePath,
        fileType: 'pdf',
        showMenu: true,
        success: () => {},
        fail: () => {
          showToast('打开文件失败');
        },
      });
    } catch (e) {
      wx.hideLoading();
      console.error('Download PDF failed', e);
      showToast('生成文件失败');
    } finally {
      this.setData({ downloading: false });
    }
  },

  onShareAppMessage() {
    const { contract } = this.data;
    const id = contract._id || contract.id;
    return {
      title: `【签约邀请】${contract.title}`,
      path: `/pages/contract-detail/contract-detail?id=${id}&from=share`,
      imageUrl: '',
    };
  },
});
