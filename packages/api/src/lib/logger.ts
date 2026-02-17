import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  ...(isDev && {
    transport: {
      target: 'pino/file',
      options: { destination: 1 }, // stdout
    },
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
  }),
});
