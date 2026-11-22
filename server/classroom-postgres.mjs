import postgres from 'postgres';

let client;
export function classroomPostgres() {
  const url = process.env.CLASSROOM_DATABASE_URL?.trim();
  if (!url) return null;
  client ??= postgres(url, { max: 2, prepare: false, connect_timeout: 5, idle_timeout: 20,
    ssl: 'verify-full', types: { bigint: postgres.BigInt } });
  return client;
}

export function postgresClassroomAdapter(query) {
  return { prepare: sql => ({ bind: (...values) => {
    let i = 0;
    // Only fixed, server-authored classroom statements use this adapter. Values stay bound.
    const statement = sql.replace(/\?/g, () => `$${++i}`).replace(/\b(INSERT INTO|UPDATE|FROM) classroom_live\b/g, '$1 classroom_private.classroom_live');
    return {
      first: async () => {
        const [row] = await query(statement, values);
        if (!row) return null;
        for (const key of ['measured_at', 'received_at', 'above_since', 'revision']) {
          if (row[key] != null) row[key] = Number(row[key]);
        }
        return row;
      },
      run: async () => ({ meta: { changes: (await query(statement, values)).count } }),
    };
  } }) };
}

export async function allowVercelUnlock(sql) {
  const result = await sql`INSERT INTO classroom_private.classroom_pin_limit (id, bucket, attempts)
    VALUES (1, floor(extract(epoch FROM now()) / 60)::bigint, 1)
    ON CONFLICT (id) DO UPDATE SET bucket = excluded.bucket,
      attempts = CASE WHEN classroom_pin_limit.bucket = excluded.bucket THEN classroom_pin_limit.attempts + 1 ELSE 1 END
    WHERE classroom_pin_limit.bucket < excluded.bucket OR (classroom_pin_limit.bucket = excluded.bucket AND classroom_pin_limit.attempts < 50)
    RETURNING attempts`;
  return result.length === 1;
}
