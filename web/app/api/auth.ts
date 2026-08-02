import { getChatGPTUser } from "../chatgpt-auth";

export async function requireApiUser() {
  const user = await getChatGPTUser();
  if (!user) return { error: Response.json({ error: "authentication required" }, { status: 401 }) };
  return { user };
}
