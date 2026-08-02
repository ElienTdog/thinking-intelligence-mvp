import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { judgmentDeltas, materials, questions } from "../../../db/schema";
import { requireApiUser } from "../auth";

export async function GET() {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;

  const db = getDb();
  const [questionRows, materialRows, deltaRows] = await Promise.all([
    db.select().from(questions).where(eq(questions.ownerId, auth.user.userId)).orderBy(asc(questions.priority), desc(questions.createdAt)),
    db.select().from(materials).where(eq(materials.ownerId, auth.user.userId)).orderBy(desc(materials.createdAt)),
    db.select().from(judgmentDeltas).where(eq(judgmentDeltas.ownerId, auth.user.userId)).orderBy(desc(judgmentDeltas.createdAt)),
  ]);
  return Response.json({ questions: questionRows, materials: materialRows, deltas: deltaRows });
}
