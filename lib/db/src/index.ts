import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { pool } from "./pool.js";

export { pool };
export const db = drizzle(pool, { schema });

export * from "./schema";
export { runMigrations } from "./migrate.js";
