import { campusHour } from '../../lib/campus-time.js';
import { feeScheduleService } from '../fees/fee-schedule.service.js';
import type { LiveContext } from './parking.mappers.js';

/** The current campus hour and fee schedule that live session views are computed against. */
export const liveContext = async (): Promise<LiveContext> => ({
  currentHour: campusHour(),
  schedule: await feeScheduleService.find(),
});
