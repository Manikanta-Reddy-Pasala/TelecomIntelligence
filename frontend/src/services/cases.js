import api from './api';

export const casesService = {
  async getCases(status) {
    const params = {};
    if (status) params.status = status;
    const response = await api.get('/cases', { params });
    return response.data;
  },

  async getCase(id) {
    const response = await api.get(`/cases/${id}`);
    return response.data;
  },

  async createCase(data) {
    const response = await api.post('/cases', data);
    return response.data;
  },

  async updateCase(id, data) {
    const response = await api.put(`/cases/${id}`, data);
    return response.data;
  },

  async addCaseEntity(caseId, data) {
    const response = await api.post(`/cases/${caseId}/entities`, data);
    return response.data;
  },

  async addCaseInsight(caseId, data) {
    const response = await api.post(`/cases/${caseId}/insights`, data);
    return response.data;
  },

  async getCaseNotebook(caseId) {
    const response = await api.get(`/cases/${caseId}/notebook`);
    return response.data;
  },
};
