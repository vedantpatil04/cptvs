import { AppError } from '../../lib/errors.js';

export const notificationErrors = {
  notFound: () => new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.'),
};
