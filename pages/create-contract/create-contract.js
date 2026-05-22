const { PRESET_TEMPLATES, PRESET_TAG_LIST, PRESET_CATEGORIES, PRESET_DOCUMENT_TEMPLATES, SIGNER_ROLES } = require('../../utils/constants');
const { addContract, addContracts, updateContract, removeContract, getContractById, getCustomTemplates, getDocumentTemplates, getCustomCategories, getSignatures, getStamps } = require('../../utils/cloud-db');
const { generateId, showToast, formatDate, getTagColor } = require('../../utils/util');
const app = getApp();

Page({
  data: {
    template: {},
    isDocumentTemplate: false,
    markersSummary: { signature: 0, stamp: 0, date: 0 },
    today: '',
    categories: [...PRESET_CATEGORIES],
    availableTags: [],
    selectedTagMap: {},
    customTagInput: '',
    formData: {
      title: '',
      category: '默认',
      tags: [],
      fields: {},
      signers: [],
      deadline: '',
    },
    myRole: 0,
    myRoleLabel: '甲方',
    otherRoleLabel: '乙方',
    signerRoles: SIGNER_ROLES.slice(0, 2),
    mySignatures: [],
    selectedSignature: null,
    myStamps: [],
    selectedStamp: null,
    idTypeOptions: ['身份证', '护照', '营业执照', '其他'],
    initiatorName: '',
  },

  async onLoad(options) {
    const { templateId, templateType, contractId } = options;
    const today = formatDate(new Date(), 'YYYY-MM-DD');

    const availableTags = PRESET_TAG_LIST.map(t => ({
      name: t.name,
      ...getTagColor(t.name),
    }));

    await app.loginPromise;

    const customCats = await getCustomCategories();
    const categories = [...PRESET_CATEGORIES, ...customCats];

    // 编辑已有合约：加载已有数据回填
    if (contractId) {
      try {
        console.log('[onLoad] EDIT mode, contractId:', contractId);
        const contract = await getContractById(contractId);
        console.log('[onLoad] contract loaded, keys:', contract ? Object.keys(contract).join(',') : 'null');
        if (!contract) {
          console.error('[onLoad] contract is null!');
          showToast('合约不存在');
          return;
        }
        this.editingContractId = contractId;
        const savedFormData = contract.formData || {};
        const tplId = contract.templateId || templateId;
        console.log('[onLoad] contract.templateId:', contract.templateId, 'tplId:', tplId);
        console.log('[onLoad] contract.isDocumentTemplate:', contract.isDocumentTemplate);
        console.log('[onLoad] contract.initiatorName:', contract.initiatorName);
        console.log('[onLoad] contract.selectedSignatureId:', contract.selectedSignatureId);
        console.log('[onLoad] contract.selectedStampId:', contract.selectedStampId);
        console.log('[onLoad] contract.signers count:', (contract.signers || []).length);
        console.log('[onLoad] contract.formData signers count:', (savedFormData.signers || []).length);

        const customTpls = await getCustomTemplates();
        const docTpls = await getDocumentTemplates();
        console.log('[onLoad] customTpls:', customTpls.length, 'docTpls:', docTpls.length);

        const template = PRESET_TEMPLATES.find(t => t.id === tplId)
          || customTpls.find(t => t.id === tplId)
          || [...PRESET_DOCUMENT_TEMPLATES, ...docTpls].find(t => t.id === tplId || t._id === tplId)
          || {};
        console.log('[onLoad] template found:', Object.keys(template).length > 0 ? 'YES' : 'NO', 'id:', template.id || template._id);

          // 回填标签选中状态
          const selectedTagMap = {};
          (savedFormData.tags || []).forEach(t => { selectedTagMap[t] = true; });
          // 确保已有标签出现在可选列表中
          const tagList = [...availableTags];
          (savedFormData.tags || []).forEach(t => {
            if (!tagList.find(a => a.name === t)) {
              tagList.push({ name: t, color: '#909399', bg: '#F4F4F5' });
            }
          });

          // 回填签署方（草稿中 signers 没有 role，全部回填）
          const otherSigners = (contract.signers || [])
            .filter(s => !s.role || s.role !== contract.myRoleLabel)
            .map(s => ({
              name: s.name || '', phone: s.phone || '',
              fillMode: s.fillMode || 'initiator',
              idType: s.idType || '', idNumber: s.idNumber || '',
              idTypeIndex: s.idType ? this.data.idTypeOptions.indexOf(s.idType) : 0,
              copies: s.copies || 1,
            }));

          // 同时从 savedFormData.signers 恢复 copies（formData 中保存了完整信息）
          const savedSigners = savedFormData.signers || [];
          for (let i = 0; i < otherSigners.length && i < savedSigners.length; i++) {
            if (savedSigners[i].copies) otherSigners[i].copies = savedSigners[i].copies;
            if (savedSigners[i].fillMode) otherSigners[i].fillMode = savedSigners[i].fillMode;
          }

        console.log('[onLoad] otherSigners:', JSON.stringify(otherSigners));
        console.log('[onLoad] initiatorName restore:', contract.initiatorName || (contract.initiator ? contract.initiator.name : ''));

        const myRole = contract.myRole || 0;
        this.setData({
          template,
            isDocumentTemplate: !!contract.isDocumentTemplate,
            today,
            availableTags: tagList,
            categories,
            selectedTagMap,
            myRole,
            myRoleLabel: SIGNER_ROLES[myRole].label,
            otherRoleLabel: SIGNER_ROLES[myRole === 0 ? 1 : 0].label,
            initiatorName: contract.initiatorName || (contract.initiator ? contract.initiator.name : '') || '',
            formData: {
              title: savedFormData.title || contract.title || '',
              category: savedFormData.category || contract.category || '默认',
              tags: savedFormData.tags || [],
              fields: savedFormData.fields || {},
              signers: otherSigners,
              deadline: savedFormData.deadline || contract.deadline || '',
            },
          });

          // 文档模板回填标注信息
          if (contract.isDocumentTemplate && template.markers) {
            this.setData({
              markersSummary: {
                signature: template.markers.filter(m => m.type === 'signature').length,
                stamp: template.markers.filter(m => m.type === 'stamp').length,
                date: template.markers.filter(m => m.type === 'date').length,
              },
            });
          }

          // 回填签名和印章选择
        this._pendingSignatureId = contract.selectedSignatureId || null;
        this._pendingStampId = contract.selectedStampId || null;
        console.log('[onLoad] _pendingSignatureId:', this._pendingSignatureId);
        console.log('[onLoad] _pendingStampId:', this._pendingStampId);

        this.loadCredentials();
        console.log('[onLoad] EDIT mode done');
        return;
      } catch (e) {
        console.error('[onLoad] EDIT FAILED:', e.message, e.stack);
      }
    }

    if (templateType === 'document') {
      const savedDocTpls = await getDocumentTemplates();
      const allDocTpls = [...PRESET_DOCUMENT_TEMPLATES, ...savedDocTpls];
      const template = allDocTpls.find(t => t.id === templateId) || {};
      const markers = template.markers || [];

      this.setData({
        template,
        isDocumentTemplate: true,
        markersSummary: {
          signature: markers.filter(m => m.type === 'signature').length,
          stamp: markers.filter(m => m.type === 'stamp').length,
          date: markers.filter(m => m.type === 'date').length,
        },
        today,
        availableTags,
        categories,
        'formData.category': template.category || '默认',
        'formData.title': template.name || '',
        'formData.tags': ['重要'],
        selectedTagMap: { '重要': true },
      });
    } else {
      const customTpls = await getCustomTemplates();
      const template = PRESET_TEMPLATES.find(t => t.id === templateId)
        || customTpls.find(t => t.id === templateId)
        || {};
      this.setData({
        template,
        today,
        availableTags,
        categories,
        'formData.category': template.category || '默认',
        'formData.tags': ['重要'],
        selectedTagMap: { '重要': true },
      });
    }

    // 初始化发起方姓名：如果 userInfo.name 不是默认的"微信用户"则预填
    const uName = app.globalData.userInfo ? app.globalData.userInfo.name : '';
    if (uName && uName !== '微信用户' && uName !== '我') {
      this.setData({ initiatorName: uName });
    }

    this.loadCredentials();
  },

  onShow() {
    this.loadCredentials();
  },

  async loadCredentials() {
    try {
      const [mySignatures, myStamps] = await Promise.all([
        getSignatures(),
        getStamps(),
      ]);
      console.log('[loadCredentials] mySignatures count:', mySignatures.length, 'myStamps count:', myStamps.length);
      console.log('[loadCredentials] _pendingSignatureId:', this._pendingSignatureId);
      console.log('[loadCredentials] _pendingStampId:', this._pendingStampId);

      let selectedSignature = this.data.selectedSignature;
      if (!selectedSignature && this._pendingSignatureId) {
        selectedSignature = mySignatures.find(s => s.id === this._pendingSignatureId || s._id === this._pendingSignatureId) || null;
        console.log('[loadCredentials] restored signature by ID:', selectedSignature ? 'YES' : 'NO');
      }
      if (!selectedSignature) {
        selectedSignature = mySignatures.find(s => s.isDefault) || null;
        console.log('[loadCredentials] use default signature:', selectedSignature ? 'YES' : 'NO');
      }

      let selectedStamp = this.data.selectedStamp;
      if (!selectedStamp && this._pendingStampId) {
        selectedStamp = myStamps.find(s => s.id === this._pendingStampId || s._id === this._pendingStampId) || null;
        console.log('[loadCredentials] restored stamp by ID:', selectedStamp ? 'YES' : 'NO');
      }
      if (!selectedStamp) {
        selectedStamp = myStamps.find(s => s.isDefault) || null;
        console.log('[loadCredentials] use default stamp:', selectedStamp ? 'YES' : 'NO');
      }

      this._pendingSignatureId = null;
      this._pendingStampId = null;
      this.setData({ mySignatures, myStamps, selectedSignature, selectedStamp });
      console.log('[loadCredentials] setData done, selectedSignature:', !!selectedSignature, 'selectedStamp:', !!selectedStamp);
    } catch (e) {
      console.error('[loadCredentials] FAILED:', e.message, e.stack);
    }
  },

  switchRole() {
    const { myRole, signerRoles } = this.data;
    const newRole = myRole === 0 ? 1 : 0;
    this.setData({
      myRole: newRole,
      myRoleLabel: signerRoles[newRole].label,
      otherRoleLabel: signerRoles[newRole === 0 ? 1 : 0].label,
    });
  },

  pickSignature() {
    const { mySignatures, selectedSignature } = this.data;
    if (mySignatures.length === 0) {
      wx.showModal({
        title: '暂无签名',
        content: '请先前往"我的签名"创建手写签名',
        confirmText: '去创建',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/signature-manage/signature-manage' });
          }
        },
      });
      return;
    }
    const items = mySignatures.map(s => `${s.name || '签名'}${s.isDefault ? '（默认）' : ''}`);
    if (selectedSignature) items.push('清除选择');
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (selectedSignature && res.tapIndex === mySignatures.length) {
          this.setData({ selectedSignature: null });
        } else {
          this.setData({ selectedSignature: mySignatures[res.tapIndex] });
        }
      },
    });
  },

  pickStamp() {
    const { myStamps, selectedStamp } = this.data;
    if (myStamps.length === 0) {
      wx.showModal({
        title: '暂无印章',
        content: '请先前往"我的印章"创建印章',
        confirmText: '去创建',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/stamp-manage/stamp-manage' });
          }
        },
      });
      return;
    }
    const items = myStamps.map(s => `${s.displayName || s.companyName}${s.isDefault ? '（默认）' : ''}`);
    if (selectedStamp) items.push('清除选择');
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (selectedStamp && res.tapIndex === myStamps.length) {
          this.setData({ selectedStamp: null });
        } else {
          this.setData({ selectedStamp: myStamps[res.tapIndex] });
        }
      },
    });
  },

  editMarkers() {
    const { template } = this.data;
    wx.navigateTo({ url: `/pkg-doc/pages/doc-preview/doc-preview?templateId=${template.id}` });
  },

  onTitleInput(e) {
    this.setData({ 'formData.title': e.detail.value });
  },

  onCategorySelect(e) {
    const { name } = e.currentTarget.dataset;
    const current = this.data.formData.category;
    this.setData({
      'formData.category': current === name ? '' : name,
    });
  },

  onTagToggle(e) {
    const { name } = e.currentTarget.dataset;
    const tags = [...this.data.formData.tags];
    const map = { ...this.data.selectedTagMap };
    const idx = tags.indexOf(name);
    if (idx > -1) {
      tags.splice(idx, 1);
      delete map[name];
    } else {
      tags.push(name);
      map[name] = true;
    }
    this.setData({ 'formData.tags': tags, selectedTagMap: map });
  },

  onCustomTagInput(e) {
    this.setData({ customTagInput: e.detail.value });
  },

  addCustomTag() {
    const name = this.data.customTagInput.trim();
    if (!name) return;
    if (name.length > 10) {
      showToast('标签最多10个字');
      return;
    }
    const tags = [...this.data.formData.tags];
    if (tags.includes(name)) {
      showToast('标签已存在');
      return;
    }
    tags.push(name);
    const map = { ...this.data.selectedTagMap };
    map[name] = true;
    const availableTags = [...this.data.availableTags];
    if (!availableTags.find(t => t.name === name)) {
      availableTags.push({ name, color: '#909399', bg: '#F4F4F5' });
    }
    this.setData({
      'formData.tags': tags,
      selectedTagMap: map,
      availableTags,
      customTagInput: '',
    });
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`formData.fields.${field}`]: e.detail.value });
  },

  addSigner() {
    const { signers } = this.data.formData;
    if (signers.length >= 10) {
      showToast('最多添加10个签署方');
      return;
    }
    this.setData({
      'formData.signers': [...signers, { name: '', phone: '', fillMode: 'initiator', idType: '', idNumber: '', idTypeIndex: 0, copies: 1 }],
    });
  },

  removeSigner(e) {
    const idx = e.currentTarget.dataset.index;
    const signers = this.data.formData.signers.filter((_, i) => i !== idx);
    this.setData({ 'formData.signers': signers });
  },

  onSignerInput(e) {
    const { index, field } = e.currentTarget.dataset;
    this.setData({
      [`formData.signers[${index}].${field}`]: e.detail.value,
    });
  },

  switchFillMode(e) {
    const { index, mode } = e.currentTarget.dataset;
    this.setData({
      [`formData.signers[${index}].fillMode`]: mode,
    });
  },

  onIdTypePick(e) {
    const index = e.currentTarget.dataset.index;
    const typeIndex = e.detail.value;
    this.setData({
      [`formData.signers[${index}].idType`]: this.data.idTypeOptions[typeIndex],
      [`formData.signers[${index}].idTypeIndex`]: typeIndex,
    });
  },

  onDeadlineChange(e) {
    this.setData({ 'formData.deadline': e.detail.value });
  },

  onInitiatorNameInput(e) {
    this.setData({ initiatorName: e.detail.value });
  },

  increaseCopies(e) {
    const idx = e.currentTarget.dataset.index;
    const cur = this.data.formData.signers[idx].copies || 1;
    if (cur >= 20) { showToast('最多20份'); return; }
    this.setData({ [`formData.signers[${idx}].copies`]: cur + 1 });
  },

  decreaseCopies(e) {
    const idx = e.currentTarget.dataset.index;
    const cur = this.data.formData.signers[idx].copies || 1;
    if (cur <= 1) return;
    this.setData({ [`formData.signers[${idx}].copies`]: cur - 1 });
  },

  validate() {
    const { formData, selectedSignature, isDocumentTemplate, markersSummary, initiatorName } = this.data;
    if (!initiatorName || !initiatorName.trim()) {
      showToast('请输入姓名/单位名称');
      return false;
    }
    if (!formData.title.trim()) {
      showToast('请输入合约标题');
      return false;
    }
    if (!selectedSignature) {
      showToast('请选择您的签名');
      return false;
    }
    if (isDocumentTemplate && markersSummary.stamp > 0 && !this.data.selectedStamp) {
      showToast('文档含盖章位，请选择印章');
      return false;
    }
    if (formData.signers.length === 0) {
      showToast('请添加至少一个签署方');
      return false;
    }
    for (let i = 0; i < formData.signers.length; i++) {
      const s = formData.signers[i];
      if (s.fillMode === 'signer') continue;
      if (!s.name.trim()) {
        showToast(`请输入第${i + 1}个签署方姓名`);
        return false;
      }
      if (!/^1\d{10}$/.test(s.phone)) {
        showToast(`第${i + 1}个签署方手机号格式不正确`);
        return false;
      }
    }
    return true;
  },

  async saveDraft() {
    const { formData, template, myRole, myRoleLabel, otherRoleLabel, selectedSignature, selectedStamp, isDocumentTemplate, initiatorName } = this.data;
    if (!formData.title.trim()) {
      showToast('请至少输入合约标题');
      return;
    }

    const formDataCopy = JSON.parse(JSON.stringify(formData));

    const draft = {
      title: formDataCopy.title,
      templateId: template.id || template._id || '',
      templateName: template.name || '自定义合约',
      category: formDataCopy.category,
      tags: formDataCopy.tags || [],
      status: 'draft',
      myRole,
      myRoleLabel,
      otherRoleLabel,
      isDocumentTemplate,
      ...(isDocumentTemplate ? { docFileName: template.fileName, docPageCount: template.pageCount } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      initiatorName: (initiatorName || '').trim(),
      initiator: {
        name: (initiatorName || '').trim() || (app.globalData.userInfo ? app.globalData.userInfo.name : '') || '发起方',
        avatar: '',
      },
      signers: formDataCopy.signers.map(s => ({
        name: s.name || '',
        phone: s.phone || '',
        status: 'pending',
        signedAt: null,
        fillMode: s.fillMode || 'initiator',
        idType: s.idType || '',
        idNumber: s.idNumber || '',
        copies: s.copies || 1,
      })),
      selectedSignatureId: selectedSignature ? (selectedSignature.id || selectedSignature._id) : null,
      selectedStampId: selectedStamp ? (selectedStamp.id || selectedStamp._id) : null,
      formData: formDataCopy,
    };

    console.log('[saveDraft] ===== START =====');
    console.log('[saveDraft] editingContractId:', this.editingContractId);
    console.log('[saveDraft] template.id:', template.id, 'template._id:', template._id);
    console.log('[saveDraft] initiatorName:', initiatorName);
    console.log('[saveDraft] selectedSignature:', selectedSignature ? { id: selectedSignature.id, _id: selectedSignature._id } : null);
    console.log('[saveDraft] selectedStamp:', selectedStamp ? { id: selectedStamp.id, _id: selectedStamp._id } : null);
    console.log('[saveDraft] isDocumentTemplate:', isDocumentTemplate);
    console.log('[saveDraft] formDataCopy signers count:', formDataCopy.signers.length);
    console.log('[saveDraft] draft.templateId:', draft.templateId);
    console.log('[saveDraft] draft keys:', Object.keys(draft).join(','));
    console.log('[saveDraft] draft.formData fields:', JSON.stringify(Object.keys(draft.formData)));
    console.log('[saveDraft] draft.signers:', JSON.stringify(draft.signers));
    console.log('[saveDraft] draft.selectedSignatureId:', draft.selectedSignatureId);
    console.log('[saveDraft] draft.selectedStampId:', draft.selectedStampId);
    console.log('[saveDraft] draft JSON length:', JSON.stringify(draft).length);

    try {
      if (this.editingContractId) {
        const updateData = { ...draft };
        delete updateData.createdAt;
        console.log('[saveDraft] UPDATE mode, id:', this.editingContractId);
        console.log('[saveDraft] updateData keys:', Object.keys(updateData).join(','));
        await updateContract(this.editingContractId, updateData);
        console.log('[saveDraft] UPDATE success');
      } else {
        console.log('[saveDraft] ADD mode');
        const result = await addContract(draft);
        console.log('[saveDraft] ADD result:', JSON.stringify(result));
        this.editingContractId = result._id || result.id;
        console.log('[saveDraft] saved editingContractId:', this.editingContractId);
      }
      showToast('草稿已保存');
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (e) {
      console.error('[saveDraft] FAILED:', e);
      console.error('[saveDraft] error message:', e.message);
      console.error('[saveDraft] error stack:', e.stack);
      showToast('保存失败: ' + (e.message || '未知错误'));
    }
  },

  submitContract() {
    if (!this.validate()) return;

    const { formData, template, myRole, myRoleLabel, otherRoleLabel, selectedSignature, selectedStamp, isDocumentTemplate } = this.data;

    // 计算总份数
    let totalCopies = 0;
    for (const s of formData.signers) {
      totalCopies += (s.fillMode === 'signer') ? (s.copies || 1) : 1;
    }

    wx.showModal({
      title: '确认发起签约',
      content: `您作为${myRoleLabel}，将生成 ${totalCopies} 份合约并发起签约邀请`,
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '提交中...', mask: true });
          const now = new Date().toISOString();
          const formDataCopy = JSON.parse(JSON.stringify(formData));

          // 发起方签署信息（自动标记为已签署）
          const initiatorName = this.data.initiatorName.trim() || (app.globalData.userInfo ? app.globalData.userInfo.name : '') || '发起方';
          const initiatorPhone = app.globalData.userInfo ? app.globalData.userInfo.phone : '';
          const initiatorSigner = {
            name: initiatorName,
            phone: initiatorPhone,
            role: myRoleLabel,
            status: 'signed',
            signedAt: now,
            signatureFileID: selectedSignature ? selectedSignature.image : null,
            stampFileID: selectedStamp ? selectedStamp.image : null,
          };

          // 每个签署方生成独立合约（对方填写模式按 copies 数生成多份）
          const batchId = generateId();
          const expandedSigners = [];
          for (const s of formData.signers) {
            const copies = (s.fillMode === 'signer') ? (s.copies || 1) : 1;
            for (let c = 0; c < copies; c++) {
              expandedSigners.push(s);
            }
          }

          const contractsToCreate = expandedSigners.map((s, i) => {
            const otherSigner = {
              name: s.name,
              phone: s.phone,
              role: otherRoleLabel,
              status: 'pending',
              signedAt: null,
              fillMode: s.fillMode || 'initiator',
              idType: s.idType || '',
              idNumber: s.idNumber || '',
            };

            return {
              title: formDataCopy.title,
              templateId: template.id || template._id || '',
              templateName: template.name || '自定义合约',
              category: formDataCopy.category,
              tags: formDataCopy.tags || [],
              status: 'pending',
              myRole,
              myRoleLabel,
              otherRoleLabel,
              isDocumentTemplate,
              ...(isDocumentTemplate ? { docFileName: template.fileName, docPageCount: template.pageCount } : {}),
              createdAt: now,
              updatedAt: now,
              batchId,
              signerIndex: i,
              totalInBatch: expandedSigners.length,
              initiator: {
                name: initiatorName,
                avatar: '',
              },
              signers: [initiatorSigner, otherSigner],
              selectedSignatureId: selectedSignature ? (selectedSignature.id || selectedSignature._id) : null,
              selectedStampId: selectedStamp ? (selectedStamp.id || selectedStamp._id) : null,
              formData: formDataCopy,
            };
          });

          try {
            if (this.editingContractId) {
              await removeContract(this.editingContractId);
            }
            await addContracts(contractsToCreate);
            wx.hideLoading();
            // 跳转到批量转发页面
            wx.redirectTo({
              url: `/pages/batch-share/batch-share?batchId=${batchId}&title=${encodeURIComponent(formData.title)}`,
            });
          } catch (e) {
            wx.hideLoading();
            showToast('提交失败');
          }
        }
      },
    });
  },
});
