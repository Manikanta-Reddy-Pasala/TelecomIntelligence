import api from './api';

export const copilotService = {
  async chat(message, caseId, conversationHistory, dateFrom, dateTo) {
    const payload = { message };
    if (caseId) payload.case_id = caseId;
    if (conversationHistory) payload.conversation_history = conversationHistory;
    if (dateFrom) payload.date_from = dateFrom;
    if (dateTo) payload.date_to = dateTo;
    const response = await api.post('/copilot/chat', payload);
    return response.data;
  },

  async getSuggestions(caseId) {
    const response = await api.get(`/copilot/suggestions/${caseId}`);
    return response.data;
  },
};
