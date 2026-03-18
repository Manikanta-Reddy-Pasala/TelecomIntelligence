import api from './api';

export const opIntelService = {
  // Dashboard
  async getDashboard() {
    const response = await api.get('/ops/dashboard');
    return response.data;
  },

  // Cell Recommendations
  async getRecommendations(msisdn, days = 90, topN = 20) {
    const response = await api.get(`/ops/recommend-cells/${encodeURIComponent(msisdn)}`, {
      params: { days, top_n: topN },
    });
    return response.data;
  },

  // TA Location
  async locate(msisdn, hours = 24, environment = 'urban') {
    const response = await api.get(`/ops/locate/${encodeURIComponent(msisdn)}`, {
      params: { hours, environment },
    });
    return response.data;
  },

  async getPrecisionHeatmap(msisdn, hours = 24, gridSize = 20) {
    const response = await api.get(`/ops/precision-heatmap/${encodeURIComponent(msisdn)}`, {
      params: { hours, grid_size: gridSize },
    });
    return response.data;
  },

  async validateTA(msisdn, hours = 24) {
    const response = await api.get(`/ops/ta-validate/${encodeURIComponent(msisdn)}`, {
      params: { hours },
    });
    return response.data;
  },

  // RF Model
  async getRFModel(towerId) {
    const response = await api.get(`/ops/rf-model/${encodeURIComponent(towerId)}`);
    return response.data;
  },

  // Capture History
  async getCaptures(params = {}) {
    const response = await api.get('/ops/capture-history', { params });
    return response.data;
  },

  async createCapture(data) {
    const response = await api.post('/ops/capture-history', data);
    return response.data;
  },

  async getSimilarCaptures(msisdn, limit = 10) {
    const response = await api.get(`/ops/capture-history/similar/${encodeURIComponent(msisdn)}`, {
      params: { limit },
    });
    return response.data;
  },

  async getCaptureMetrics() {
    const response = await api.get('/ops/capture-history/metrics');
    return response.data;
  },

  // Playbooks
  async getPlaybooks(targetType) {
    const params = {};
    if (targetType) params.target_type = targetType;
    const response = await api.get('/ops/playbooks', { params });
    return response.data;
  },

  async getPlaybook(id) {
    const response = await api.get(`/ops/playbooks/${id}`);
    return response.data;
  },

  async executePlaybook(data) {
    const response = await api.post('/ops/playbooks/execute', data);
    return response.data;
  },

  async updateExecution(executionId, data) {
    const response = await api.put(`/ops/playbooks/executions/${executionId}`, data);
    return response.data;
  },

  async getExecutions(params = {}) {
    const response = await api.get('/ops/playbooks/executions', { params });
    return response.data;
  },

  async suggestPlaybook(msisdn) {
    const response = await api.post(`/ops/playbooks/suggest?msisdn=${encodeURIComponent(msisdn)}`);
    return response.data;
  },
};
