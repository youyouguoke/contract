const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action, contractId, updateData, filter } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    switch (action) {
      case 'getById': {
        if (!contractId) return { code: -1, message: 'Missing contractId' };
        const res = await db.collection('contracts').doc(contractId).get();
        const contract = res.data;
        // 附带发起方标识，前端无法读取 _openid 做比较
        contract._isInitiator = (contract._openid === openid);
        return { code: 0, data: contract };
      }

      case 'list': {
        // 查询当前用户相关的合约：自己创建的 + 自己是签署方的
        // 先查自己创建的
        const ownWhere = { _openid: openid };
        if (filter && filter.status) ownWhere.status = filter.status;
        const ownRes = await db.collection('contracts')
          .where(ownWhere)
          .orderBy('updatedAt', 'desc')
          .limit(100)
          .get();

        // 再查自己是签署方的（别人创建、自己参与签署的）
        const signerWhere = {
          _openid: _.neq(openid),
          'signers.signedByOpenid': openid,
        };
        if (filter && filter.status) signerWhere.status = filter.status;
        let signerContracts = [];
        try {
          const signerRes = await db.collection('contracts')
            .where(signerWhere)
            .orderBy('updatedAt', 'desc')
            .limit(100)
            .get();
          signerContracts = signerRes.data;
        } catch (_e) {
          // signers 中可能没有 signedByOpenid 字段，忽略
        }

        // 合并去重，按 updatedAt 降序
        const allMap = {};
        for (const c of ownRes.data) {
          c._isInitiator = true;
          allMap[c._id] = c;
        }
        for (const c of signerContracts) {
          if (!allMap[c._id]) {
            c._isInitiator = false;
            allMap[c._id] = c;
          }
        }
        const all = Object.values(allMap).sort((a, b) => {
          return (b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1;
        });
        return { code: 0, data: all };
      }

      case 'update': {
        if (!contractId || !updateData) return { code: -1, message: 'Missing params' };

        // Security: only allow initiator or pending signer to update
        const contractRes = await db.collection('contracts').doc(contractId).get();
        const contract = contractRes.data;

        const isInitiator = contract._openid === openid;
        const isSigner = (contract.signers || []).some(s => {
          return s.status === 'pending';
        });

        if (!isInitiator && !isSigner) {
          return { code: -1, message: 'No permission' };
        }

        // 如果更新包含 signers，为新签署的签署方记录 openid（用于合约列表查询）
        if (updateData.signers && Array.isArray(updateData.signers)) {
          const oldSigners = contract.signers || [];
          for (let i = 0; i < updateData.signers.length; i++) {
            const newS = updateData.signers[i];
            const oldS = oldSigners[i];
            // 从 pending 变为 signed，且不是发起方 → 记录签署方 openid
            if (newS.status === 'signed' && oldS && oldS.status === 'pending') {
              newS.signedByOpenid = openid;
            }
            // 保留已有的 signedByOpenid
            if (!newS.signedByOpenid && oldS && oldS.signedByOpenid) {
              newS.signedByOpenid = oldS.signedByOpenid;
            }
          }
        }

        await db.collection('contracts').doc(contractId).update({ data: updateData });
        return { code: 0 };
      }

      default:
        return { code: -1, message: 'Unknown action: ' + action };
    }
  } catch (e) {
    // doc not found
    if (e.errCode === -1 || (e.message && e.message.includes('not exist'))) {
      return { code: -1, message: 'Contract not found' };
    }
    return { code: -1, message: e.message || 'Server error' };
  }
};
