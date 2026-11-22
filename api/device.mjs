import { json } from '../server/http.mjs';

export default async function handler(req, res) {
  return json(res, 410, { error: 'record sharing discontinued' });
}
