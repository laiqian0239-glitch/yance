export async function run(db, sql, values = []) {
  return db.prepare(sql).bind(...values).run();
}
export async function first(db, sql, values = []) {
  return db.prepare(sql).bind(...values).first();
}
export async function all(db, sql, values = []) {
  const result = await db.prepare(sql).bind(...values).all();
  return Array.isArray(result?.results) ? result.results : [];
}
export function statement(db, sql, values = []) { return db.prepare(sql).bind(...values); }
export async function batch(db, statements = []) { return db.batch(statements); }
export function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}
