import { prisma } from "../lib/prisma";

type Requirement = {
  table: string;
  columns: string[];
};

const requirements: Requirement[] = [
  { table: "users", columns: ["id", "email", "password_hash"] },
  { table: "prayer_locations", columns: ["id", "latitude", "longitude"] },
  { table: "prayers", columns: ["id", "location_id"] },
  { table: "prayer_sessions", columns: ["id", "user_id", "location_id"] },
  { table: "completions", columns: ["id", "user_id", "location_id"] },
  { table: "badges", columns: ["id", "user_id", "name"] }
];

export async function verifyDatabaseSchema(): Promise<void> {
  for (const req of requirements) {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${req.table}
    `;

    if (columns.length === 0) {
      throw new Error(`Missing table: ${req.table}`);
    }

    const columnSet = new Set(columns.map((c) => c.column_name));
    for (const c of req.columns) {
      if (!columnSet.has(c)) {
        throw new Error(`Missing column ${req.table}.${c}`);
      }
    }
  }
}
