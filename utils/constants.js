/**
 * 预设常量 - 不随用户变化的静态配置数据
 */

/** 签署方角色配置 */
const SIGNER_ROLES = [
  { label: '甲方', color: '#4F7CFF', bg: '#ECF2FF' },
  { label: '乙方', color: '#FF9500', bg: '#FFF7ED' },
  { label: '丙方', color: '#19BE6B', bg: '#E8F8EF' },
  { label: '丁方', color: '#9B59B6', bg: '#F3ECF9' },
];

/** 标记类型配置 */
const MARKER_TYPES = {
  signature: { icon: '📝', label: '签名', color: '#4F7CFF', bg: '#ECF2FF', defaultWidthPercent: 25, defaultHeightPercent: 8 },
  stamp: { icon: '🔴', label: '盖章', color: '#FA3534', bg: '#FEF0F0', defaultWidthPercent: 20, defaultHeightPercent: 20 },
  date: { icon: '📅', label: '日期', color: '#19BE6B', bg: '#E8F8EF', defaultWidthPercent: 20, defaultHeightPercent: 6 },
};

/** 预设模板 */
const PRESET_TEMPLATES = [
  {
    id: 'tpl_001',
    name: '通用合约',
    category: '默认',
    icon: '📋',
    description: '适用于大多数场景的通用签约模板',
    fields: ['甲方名称', '合约内容'],
  },
];

/** 预设标签 */
const PRESET_TAG_LIST = [
  { id: 'tag_vip', name: '重要', color: '#FA3534' },
  { id: 'tag_urgent', name: '加急', color: '#E6A23C' },
  { id: 'tag_renew', name: '续签', color: '#4F7CFF' },
  { id: 'tag_longterm', name: '长期', color: '#19BE6B' },
  { id: 'tag_shortterm', name: '短期', color: '#909399' },
];

/** 预设分类 */
const PRESET_CATEGORIES = [
  { id: 'cat_default', name: '默认', icon: '📋' },
  { id: 'cat_biz', name: '商务', icon: '💼' },
  { id: 'cat_hr', name: '人事', icon: '👥' },
  { id: 'cat_other', name: '其他', icon: '📁' },
];

/** 预设文档模板 */
const PRESET_DOCUMENT_TEMPLATES = [];

module.exports = {
  SIGNER_ROLES,
  MARKER_TYPES,
  PRESET_TEMPLATES,
  PRESET_TAG_LIST,
  PRESET_CATEGORIES,
  PRESET_DOCUMENT_TEMPLATES,
};
