import api from './api';

export const auditService = {
  async getAuditLogs(userId, action, from, to, page, limit) {
    const params = {};
    if (userId) params.user_id = userId;
    if (action) params.action = action;
    if (from) params.from = from;
    if (to) params.to = to;
    if (page) params.page = page;
    if (limit) params.limit = limit;
    const response = await api.get('/audit/logs', { params });
    return response.data;
  },
};
