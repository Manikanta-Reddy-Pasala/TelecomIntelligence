import api from './api';

export const advancedService = {
  async towerDump(towerId, from, to) {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const response = await api.get(`/advanced/tower-dump/${towerId}`, { params });
    return response.data;
  },

  async geofence(bounds) {
    const response = await api.post('/advanced/geofence', bounds);
    return response.data;
  },

  async patternOfLife(msisdn, days) {
    const params = {};
    if (days) params.days = days;
    const response = await api.get(`/advanced/pattern-of-life/${msisdn}`, { params });
    return response.data;
  },

  async identityChanges(msisdn) {
    const response = await api.get(`/advanced/identity-changes/${msisdn}`);
    return response.data;
  },

  async commonNumbers(msisdns) {
    const response = await api.post('/advanced/common-numbers', { msisdns });
    return response.data;
  },

  async callChain(source, target, maxHops) {
    const params = { source, target };
    if (maxHops) params.max_hops = maxHops;
    const response = await api.get('/advanced/call-chain', { params });
    return response.data;
  },

  async nightActivity(msisdn, from, to) {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const response = await api.get(`/advanced/night-activity/${msisdn}`, { params });
    return response.data;
  },

  async topContacts(msisdn, limit) {
    const params = {};
    if (limit) params.limit = limit;
    const response = await api.get(`/advanced/top-contacts/${msisdn}`, { params });
    return response.data;
  },

  async generateReport(msisdn) {
    const response = await api.post(`/advanced/report/${msisdn}`);
    return response.data;
  },

  async activityStats(msisdn) {
    const response = await api.get(`/advanced/stats/${msisdn}`);
    return response.data;
  },
};
