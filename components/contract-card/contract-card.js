const { getStatusInfo, getTagColor, timeAgo } = require('../../utils/util');

Component({
  properties: {
    contract: {
      type: Object,
      value: {},
    },
  },

  observers: {
    'contract': function(contract) {
      if (!contract || (!contract._id && !contract.id)) return;
      const tagList = (contract.tags || []).map(name => ({
        name,
        ...getTagColor(name),
      }));

      // 拆分合约：只显示对方签署方名字
      let signersText;
      const signers = contract.signers || [];
      if (contract.batchId && signers.length === 2) {
        const target = signers[1];
        signersText = target.name || (target.fillMode === 'signer' ? '待对方填写' : '暂无');
      } else {
        signersText = signers.map(s => s.name || '待填写').join('、') || '暂无';
      }

      this.setData({
        statusInfo: getStatusInfo(contract.status),
        signersText,
        timeText: timeAgo(contract.updatedAt || contract.createdAt),
        tagList,
      });
    },
  },

  data: {
    statusInfo: {},
    signersText: '',
    timeText: '',
    tagList: [],
  },

  methods: {
    onTap() {
      const { contract } = this.properties;
      this.triggerEvent('cardtap', { id: contract._id || contract.id });
    },
  },
});
