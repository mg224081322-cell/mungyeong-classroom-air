import classroom from '../worker/classroom.ts';
import { classroomPostgres, postgresClassroomAdapter } from '../server/classroom-postgres.mjs';

const routePattern = /^\/classrooms\/[a-z0-9-]+\/(?:latest|teacher\/(?:state|device|policy)|device\/(?:reading|disconnect))$/;
const answer = (error, status) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export function createClassroomHandler(getDb, pin) {
  return async request => {
    const url = new URL(request.url);
    const { searchParams: params } = url;
    const room = params.get('room') ?? '';
    const scope = params.get('scope');
    const action = params.get('action') ?? '';
    const route = url.pathname.startsWith('/api/classrooms/') ? url.pathname.slice(4) :
      url.pathname === '/api/classroom' ? `/classrooms/${room}/${scope ? `${scope}/` : ''}${action}` : '';
    if (!routePattern.test(route)) return answer('not found', 404);
    try {
      const DB = getDb();
      if (!DB) return answer('classroom storage not configured', 503);
      const forwarded = new Request(new URL(route, url), request);
      return await classroom.fetch(forwarded, { DB, TEACHER_PIN: pin() });
    } catch { return answer('classroom storage unavailable', 503); }
  };
}

export default { fetch: createClassroomHandler(() => {
  const sql = classroomPostgres();
  return sql ? postgresClassroomAdapter((text, values) => sql.unsafe(text, values)) : null;
}, () => process.env.TEACHER_PIN) };
