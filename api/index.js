import { createApplication } from '../server/index.mjs';

const application = createApplication();

export default async function handler(req, res) {
  const { server } = await application;
  server.emit('request', req, res);
}
