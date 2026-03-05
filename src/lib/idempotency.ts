import crypto from "crypto";
import { prisma } from "./db";
import { DomainError } from "../errors/domainError";

type JsonObject = Record<string, unknown>;

type IdempotentExecution = {
  statusCode: number;
  body: JsonObject;
};

type IdempotentResult = IdempotentExecution & {
  acceptedAt: string;
  idempotentReplay: boolean;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(payload: JsonObject): string {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export async function executeIdempotentRequest(params: {
  idempotencyKey?: string;
  endpoint: string;
  userId: string;
  payload: JsonObject;
  execute: () => Promise<IdempotentExecution>;
}): Promise<IdempotentResult> {
  const { idempotencyKey, endpoint, userId, payload, execute } = params;
  const acceptedAt = new Date().toISOString();

  if (!idempotencyKey) {
    const result = await execute();
    return {
      ...result,
      acceptedAt,
      idempotentReplay: false,
    };
  }

  if (idempotencyKey.length > 64) {
    throw new DomainError("clientRequestId must be <= 64 characters", { statusCode: 400, code: "invalid_client_request_id" });
  }

  const requestHash = hashPayload(payload);
  const existing = await prisma.$queryRawUnsafe<Array<{
    idempotency_key: string;
    user_id: string;
    endpoint: string;
    request_hash: string;
    response_code: number;
    response_json: unknown;
    created_at: Date;
  }>>(
    `SELECT idempotency_key, user_id, endpoint, request_hash, response_code, response_json, created_at
     FROM mobile_sync_requests
     WHERE idempotency_key = $1
     LIMIT 1`,
    idempotencyKey
  );

  const found = existing[0];
  if (found) {
    if (found.user_id !== userId || found.endpoint !== endpoint || found.request_hash !== requestHash) {
      throw new DomainError("Idempotency key reuse with a different payload is not allowed", {
        statusCode: 409,
        code: "idempotency_key_conflict",
      });
    }

    return {
      statusCode: Number(found.response_code),
      body: (found.response_json as JsonObject) || {},
      acceptedAt: found.created_at.toISOString(),
      idempotentReplay: true,
    };
  }

  const executed = await execute();

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO mobile_sync_requests (idempotency_key, user_id, endpoint, request_hash, response_code, response_json)
       VALUES ($1, $2::uuid, $3, $4, $5, $6::jsonb)`,
      idempotencyKey,
      userId,
      endpoint,
      requestHash,
      executed.statusCode,
      JSON.stringify(executed.body)
    );
  } catch (error: any) {
    if (error?.code !== "23505") {
      throw error;
    }

    const raced = await prisma.$queryRawUnsafe<Array<{
      response_code: number;
      response_json: unknown;
      created_at: Date;
      user_id: string;
      endpoint: string;
      request_hash: string;
    }>>(
      `SELECT response_code, response_json, created_at, user_id, endpoint, request_hash
       FROM mobile_sync_requests
       WHERE idempotency_key = $1
       LIMIT 1`,
      idempotencyKey
    );
    const replay = raced[0];
    if (!replay) {
      throw error;
    }
    if (replay.user_id !== userId || replay.endpoint !== endpoint || replay.request_hash !== requestHash) {
      throw new DomainError("Idempotency key reuse with a different payload is not allowed", {
        statusCode: 409,
        code: "idempotency_key_conflict",
      });
    }
    return {
      statusCode: Number(replay.response_code),
      body: (replay.response_json as JsonObject) || {},
      acceptedAt: replay.created_at.toISOString(),
      idempotentReplay: true,
    };
  }

  return {
    ...executed,
    acceptedAt,
    idempotentReplay: false,
  };
}
