import api from './api';

export const eventsService = {
  async getCalls(msisdn, from, to, page, limit) {
    const params = { msisdn };
    if (from) params.from = from;
    if (to) params.to = to;
    if (page) params.page = page;
    if (limit) params.limit = limit;
    const response = await api.get('/events/calls', { params });
    return response.data;
  },

  async getMessages(msisdn, from, to) {
    const params = { msisdn };
    if (from) params.from = from;
    if (to) params.to = to;
    const response = await api.get('/events/messages', { params });
    return response.data;
  },

  async getLocations(msisdn, from, to) {
    const params = { msisdn };
    if (from) params.from = from;
    if (to) params.to = to;
    const response = await api.get('/events/locations', { params });
    return response.data;
  },

  async getTimeline(msisdn, from, to) {
    const params = { msisdn };
    if (from) params.from = from;
    if (to) params.to = to;
    const response = await api.get('/events/timeline', { params });
    return response.data;
  },

  async getRecentActivity(limit) {
    const params = {};
    if (limit) params.limit = limit;
    const response = await api.get('/events/recent', { params });
    return response.data;
  },
};
