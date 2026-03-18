import api from './api';

export const analyticsService = {
  async getContactNetwork(msisdn) {
    const response = await api.get(`/analytics/contacts/${msisdn}`);
    return response.data;
  },

  async getCommonContacts(msisdn1, msisdn2) {
    const response = await api.get('/analytics/common-contacts', {
      params: { msisdn1, msisdn2 },
    });
    return response.data;
  },

  async getColocation(msisdn1, msisdn2, windowMinutes) {
    const params = { msisdn1, msisdn2 };
    if (windowMinutes) params.window_minutes = windowMinutes;
    const response = await api.get('/analytics/colocation', { params });
    return response.data;
  },

  async getMovement(msisdn, from, to) {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const response = await api.get(`/analytics/movement/${msisdn}`, { params });
    return response.data;
  },

  async getTowerActivity(towerId, from, to) {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const response = await api.get(`/analytics/tower-activity/${towerId}`, { params });
    return response.data;
  },

  async getAnomalies(msisdn) {
    const params = {};
    if (msisdn) params.msisdn = msisdn;
    const response = await api.get('/analytics/anomalies', { params });
    return response.data;
  },

  async getDashboardStats() {
    const response = await api.get('/analytics/dashboard-stats');
    return response.data;
  },
};
