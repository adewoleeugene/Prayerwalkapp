import { executeRawQuery } from './db';

export async function writeAuditLog(args: {
  actorUserId?: string | null;
  action: string;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await executeRawQuery(
      `INSERT INTO audit_logs (actor_user_id, action, target_user_id, metadata)
       VALUES ($1::uuid, $2, $3::uuid, $4::jsonb)`,
      [
        args.actorUserId || null,
        args.action,
        args.targetUserId || null,
        JSON.stringify(args.metadata || {}),
      ]
    );
  } catch (error) {
    console.error('Audit log write failed:', error);
  }
}
