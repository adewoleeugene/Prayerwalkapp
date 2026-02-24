import { executeRawQuery } from './db';

export async function getTokenVersion(userId: string): Promise<number> {
  const rows = await executeRawQuery<Array<{ token_version: number | null }>>(
    'SELECT COALESCE(token_version, 0) AS token_version FROM users WHERE id = $1::uuid LIMIT 1',
    [userId]
  );
  return Number(rows[0]?.token_version ?? 0);
}

export async function bumpTokenVersion(userId: string): Promise<number> {
  const rows = await executeRawQuery<Array<{ token_version: number }>>(
     `UPDATE users
       SET token_version = COALESCE(token_version, 0) + 1,
           updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING token_version`,
    [userId]
  );
  return Number(rows[0]?.token_version ?? 0);
}
