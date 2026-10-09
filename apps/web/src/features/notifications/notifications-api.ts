import type { NotificationView, NotificationsResponse } from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

export const notificationsApi = {
  list: (query?: { unreadOnly?: boolean; limit?: number }) => {
    const params = new URLSearchParams();
    if (query?.unreadOnly) params.set('unreadOnly', 'true');
    if (query?.limit) params.set('limit', String(query.limit));
    const qs = params.toString();
    return apiRequest<NotificationsResponse>(`/notifications${qs ? `?${qs}` : ''}`);
  },

  markRead: (id: string) =>
    apiRequest<NotificationView>(`/notifications/${encodeURIComponent(id)}/read`, {
      method: 'POST',
    }),

  markAllRead: () =>
    apiRequest<{ readCount: number }>('/notifications/read-all', {
      method: 'POST',
    }),
};
