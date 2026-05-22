/**
 * 云数据库操作封装
 * 所有返回的文档自动将 _id 映射为 id，兼容现有前端代码
 */

const db = wx.cloud.database();
const _ = db.command;

function mapDoc(doc) {
  if (!doc) return doc;
  return { ...doc, id: doc._id };
}

function mapDocs(docs) {
  return (docs || []).map(mapDoc);
}

// ========== CONTRACTS ==========

async function getContracts(filter) {
  try {
    // 通过云函数查询，返回自己创建的 + 自己签署过的合约
    const res = await wx.cloud.callFunction({
      name: 'contract-api',
      data: { action: 'list', filter: filter || {} },
    });
    if (res.result && res.result.code === 0) {
      return mapDocs(res.result.data || []);
    }
    return [];
  } catch (e) {
    console.error('[cloud-db] getContracts error:', e);
    return [];
  }
}

async function getContractById(id) {
  try {
    const res = await wx.cloud.callFunction({
      name: 'contract-api',
      data: { action: 'getById', contractId: id },
    });
    if (res.result && res.result.code === 0 && res.result.data) {
      const d = mapDoc(res.result.data);
      console.log('[cloud-db] getContractById OK, keys:', Object.keys(d).join(','));
      console.log('[cloud-db] getContractById, initiatorName:', d.initiatorName);
      console.log('[cloud-db] getContractById, selectedSignatureId:', d.selectedSignatureId);
      console.log('[cloud-db] getContractById, selectedStampId:', d.selectedStampId);
      console.log('[cloud-db] getContractById, isDocumentTemplate:', d.isDocumentTemplate);
      console.log('[cloud-db] getContractById, signers count:', (d.signers || []).length);
      console.log('[cloud-db] getContractById, formData exists:', !!d.formData);
      return d;
    }
    console.error('[cloud-db] getContractById, no data returned. result:', JSON.stringify(res.result));
    return null;
  } catch (e) {
    console.error('[cloud-db] getContractById error:', e.message);
    return null;
  }
}

async function getContractsByBatchId(batchId) {
  const res = await db.collection('contracts')
    .where({ batchId })
    .orderBy('signerIndex', 'asc')
    .get();
  return mapDocs(res.data);
}

async function addContract(data) {
  console.log('[cloud-db] addContract, data keys:', Object.keys(data).join(','));
  console.log('[cloud-db] addContract, formData exists:', !!data.formData);
  console.log('[cloud-db] addContract, formData signers:', (data.formData && data.formData.signers) ? data.formData.signers.length : 0);
  console.log('[cloud-db] addContract, initiatorName:', data.initiatorName);
  console.log('[cloud-db] addContract, selectedSignatureId:', data.selectedSignatureId);
  console.log('[cloud-db] addContract, selectedStampId:', data.selectedStampId);
  try {
    const res = await db.collection('contracts').add({ data });
    console.log('[cloud-db] addContract SUCCESS, _id:', res._id);
    return { _id: res._id, id: res._id };
  } catch (e) {
    console.error('[cloud-db] addContract FAILED:', e.message, e.stack);
    throw e;
  }
}

async function addContracts(dataArray) {
  const results = [];
  for (const data of dataArray) {
    const res = await db.collection('contracts').add({ data });
    results.push({ _id: res._id, id: res._id });
  }
  return results;
}

async function updateContract(id, data) {
  console.log('[cloud-db] updateContract, id:', id);
  console.log('[cloud-db] updateContract, data keys:', Object.keys(data).join(','));
  console.log('[cloud-db] updateContract, formData exists:', !!data.formData);
  console.log('[cloud-db] updateContract, formData signers:', (data.formData && data.formData.signers) ? data.formData.signers.length : 0);
  console.log('[cloud-db] updateContract, initiatorName:', data.initiatorName);
  console.log('[cloud-db] updateContract, selectedSignatureId:', data.selectedSignatureId);
  console.log('[cloud-db] updateContract, selectedStampId:', data.selectedStampId);
  try {
    const res = await wx.cloud.callFunction({
      name: 'contract-api',
      data: { action: 'update', contractId: id, updateData: data },
    });
    console.log('[cloud-db] updateContract result code:', res.result ? res.result.code : 'null');
    if (res.result && res.result.code !== 0) {
      console.error('[cloud-db] updateContract FAILED, message:', res.result.message);
      throw new Error(res.result.message || 'Update failed');
    }
    return res.result;
  } catch (e) {
    console.error('[cloud-db] updateContract EXCEPTION:', e.message);
    throw e;
  }
}

async function removeContract(id) {
  return db.collection('contracts').doc(id).remove();
}

// ========== SIGNATURES ==========

async function getSignatures() {
  const res = await db.collection('signatures')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  return mapDocs(res.data);
}

async function addSignature(data) {
  const res = await db.collection('signatures').add({ data });
  return { _id: res._id, id: res._id };
}

async function updateSignature(id, data) {
  return db.collection('signatures').doc(id).update({ data });
}

async function removeSignature(id) {
  return db.collection('signatures').doc(id).remove();
}

// ========== STAMPS ==========

async function getStamps() {
  const res = await db.collection('stamps')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  return mapDocs(res.data);
}

async function addStamp(data) {
  const res = await db.collection('stamps').add({ data });
  return { _id: res._id, id: res._id };
}

async function updateStamp(id, data) {
  return db.collection('stamps').doc(id).update({ data });
}

async function removeStamp(id) {
  return db.collection('stamps').doc(id).remove();
}

// ========== CUSTOM TEMPLATES ==========

async function getCustomTemplates() {
  const res = await db.collection('templates')
    .where({ type: _.neq('document') })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  return mapDocs(res.data);
}

async function addCustomTemplate(data) {
  const res = await db.collection('templates').add({ data });
  return { _id: res._id, id: res._id };
}

async function removeCustomTemplate(id) {
  return db.collection('templates').doc(id).remove();
}

// ========== DOCUMENT TEMPLATES ==========

async function getDocumentTemplates() {
  const res = await db.collection('templates')
    .where({ type: 'document' })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  return mapDocs(res.data);
}

async function addDocumentTemplate(data) {
  data.type = 'document';
  const res = await db.collection('templates').add({ data });
  return { _id: res._id, id: res._id };
}

async function updateDocumentTemplate(id, data) {
  return db.collection('templates').doc(id).update({ data });
}

// ========== CUSTOM CATEGORIES ==========

async function getCustomCategories() {
  const res = await db.collection('categories')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  return mapDocs(res.data);
}

async function addCustomCategory(data) {
  data.createdAt = new Date().toISOString();
  const res = await db.collection('categories').add({ data });
  return { _id: res._id, id: res._id };
}

// ========== BY-ID HELPERS ==========

async function getSignatureById(id) {
  const res = await db.collection('signatures').where({ _id: id }).limit(1).get();
  return res.data && res.data.length > 0 ? mapDoc(res.data[0]) : null;
}

async function getStampById(id) {
  const res = await db.collection('stamps').where({ _id: id }).limit(1).get();
  return res.data && res.data.length > 0 ? mapDoc(res.data[0]) : null;
}

async function getTemplateById(id) {
  const res = await db.collection('templates').where({ _id: id }).limit(1).get();
  return res.data && res.data.length > 0 ? mapDoc(res.data[0]) : null;
}

// ========== CLOUD STORAGE ==========

async function uploadImage(filePath, cloudPath) {
  const res = await wx.cloud.uploadFile({
    cloudPath,
    filePath,
  });
  return res.fileID;
}

async function deleteImage(fileID) {
  if (!fileID || !fileID.startsWith('cloud://')) return;
  return wx.cloud.deleteFile({ fileList: [fileID] });
}

module.exports = {
  db, _,
  getContracts, getContractById, getContractsByBatchId, addContract, addContracts, updateContract, removeContract,
  getSignatures, addSignature, updateSignature, removeSignature,
  getStamps, addStamp, updateStamp, removeStamp,
  getCustomTemplates, addCustomTemplate, removeCustomTemplate,
  getDocumentTemplates, addDocumentTemplate, updateDocumentTemplate,
  getCustomCategories, addCustomCategory,
  getSignatureById, getStampById, getTemplateById,
  uploadImage, deleteImage,
};
