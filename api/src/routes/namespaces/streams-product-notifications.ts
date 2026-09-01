import type { Notification } from 'pg';

import { pool } from '../../db/client';
import type { StreamsNotificationsPort } from './streams-ports';

const CHANNEL_NAME = /^[a-z_]+$/;

export const productStreamsNotificationsPort: StreamsNotificationsPort = {
  async subscribe({ channels, onNotification }) {
    if (channels.some((channel) => !CHANNEL_NAME.test(channel))) {
      throw new Error('invalid stream notification channel');
    }
    const client = await pool.connect();
    const listener = (notification: Notification) => onNotification(notification);
    client.on('notification', listener);
    try {
      for (const channel of channels) await client.query(`LISTEN ${channel}`);
    } catch (error) {
      client.removeListener('notification', listener);
      client.release();
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      client.removeListener('notification', listener);
      try {
        for (const channel of channels) await client.query(`UNLISTEN ${channel}`);
      } finally {
        client.release();
      }
    };
  },
};
