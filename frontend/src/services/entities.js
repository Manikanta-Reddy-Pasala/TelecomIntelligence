import api from './api';

export const entitiesService = {
  async getPersons(search, page, limit) {
    const params = {};
    if (search) params.search = search;
    if (page) params.page = page;
    if (limit) params.limit = limit;
    const response = await api.get('/entities/persons', { params });
    return response.data;
  },

  async getPerson(id) {
    const response = await api.get(`/entities/persons/${id}`);
    return response.data;
  },

  async getPhone(msisdn) {
    const response = await api.get(`/entities/phones/${msisdn}`);
    return response.data;
  },

  async getDevice(imei) {
    const response = await api.get(`/entities/devices/${imei}`);
    return response.data;
  },

  async getTowers(bounds) {
    const params = {};
    if (bounds) {
      params.north = bounds.north;
      params.south = bounds.south;
      params.east = bounds.east;
      params.west = bounds.west;
    }
    const response = await api.get('/entities/towers', { params });
    return response.data;
  },

  async getTower(id) {
    const response = await api.get(`/entities/towers/${id}`);
    return response.data;
  },

  async searchEntities(query) {
    const response = await api.get('/entities/search', { params: { q: query } });
    return response.data;
  },
};
