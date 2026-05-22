/**
 * 格式化日期
 */
function formatDate(date, fmt = 'YYYY-MM-DD') {
  if (typeof date === 'string' || typeof date === 'number') {
    date = new Date(date);
  }
  const map = {
    'YYYY': date.getFullYear(),
    'MM': String(date.getMonth() + 1).padStart(2, '0'),
    'DD': String(date.getDate()).padStart(2, '0'),
    'HH': String(date.getHours()).padStart(2, '0'),
    'mm': String(date.getMinutes()).padStart(2, '0'),
    'ss': String(date.getSeconds()).padStart(2, '0'),
  };
  let result = fmt;
  for (const key in map) {
    result = result.replace(key, map[key]);
  }
  return result;
}

/**
 * 格式化相对时间
 */
function timeAgo(date) {
  if (typeof date === 'string' || typeof date === 'number') {
    date = new Date(date);
  }
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 30) return `${days}天前`;
  return formatDate(date, 'YYYY-MM-DD');
}

/**
 * 合约状态映射
 */
const CONTRACT_STATUS = {
  draft: { text: '草稿', color: '#909399', bg: '#F4F4F5' },
  pending: { text: '待签署', color: '#E6A23C', bg: '#FDF6EC' },
  signing: { text: '签署中', color: '#4F7CFF', bg: '#ECF2FF' },
  completed: { text: '已完成', color: '#19BE6B', bg: '#E8F8EF' },
  rejected: { text: '已拒绝', color: '#FA3534', bg: '#FEF0F0' },
  expired: { text: '已过期', color: '#909399', bg: '#F4F4F5' },
  revoked: { text: '已撤回', color: '#909399', bg: '#F4F4F5' },
};

function getStatusInfo(status) {
  return CONTRACT_STATUS[status] || { text: '未知', color: '#909399', bg: '#F4F4F5' };
}

/**
 * 生成唯一ID
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * 显示提示
 */
function showToast(title, icon = 'none') {
  wx.showToast({ title, icon, duration: 2000 });
}

function showLoading(title = '加载中...') {
  wx.showLoading({ title, mask: true });
}

function hideLoading() {
  wx.hideLoading();
}

/**
 * 标签颜色映射
 */
const TAG_COLORS = {
  '重要客户': { color: '#FA3534', bg: '#FEF0F0' },
  '加急': { color: '#E6A23C', bg: '#FDF6EC' },
  '续签': { color: '#4F7CFF', bg: '#ECF2FF' },
  '年度': { color: '#19BE6B', bg: '#E8F8EF' },
  '试用期': { color: '#909399', bg: '#F4F4F5' },
  '外包': { color: '#8B5CF6', bg: '#F3EFFE' },
  '合作伙伴': { color: '#0EA5E9', bg: '#E8F7FE' },
  '供应商': { color: '#F97316', bg: '#FFF3E8' },
  '长期': { color: '#10B981', bg: '#E8F8EF' },
  '短期': { color: '#6B7280', bg: '#F3F4F6' },
};

function getTagColor(tagName) {
  return TAG_COLORS[tagName] || { color: '#909399', bg: '#F4F4F5' };
}

module.exports = {
  formatDate,
  timeAgo,
  CONTRACT_STATUS,
  getStatusInfo,
  TAG_COLORS,
  getTagColor,
  generateId,
  showToast,
  showLoading,
  hideLoading,
};
