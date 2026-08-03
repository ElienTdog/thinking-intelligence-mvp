import type { Metadata } from "next";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import { JudgmentWorkbench } from "./dashboard";

export const metadata: Metadata = {
  title: "思考情报台",
  description: "一个把外部挑战变成个人判断痕迹的私有工作台。",
};

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<{ capture?: string | string[] }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const user = await getChatGPTUser();
  if (!user) {
    const requestedCapture = (await searchParams).capture;
    const capture = Array.isArray(requestedCapture) ? requestedCapture[0] : requestedCapture;
    const returnTo = capture ? `/?capture=${encodeURIComponent(capture)}` : "/";
    return <main className="access-gate"><p className="eyebrow">PRIVATE ALPHA</p><h1>把信息流变成判断痕迹。</h1><p>这是你的私有思考工作区。登录后，记录一个问题、让材料挑战它，并留下你自己的回应。</p><a className="primary link-button" href={chatGPTSignInPath(returnTo)}>使用 ChatGPT 登录</a></main>;
  }
  return <JudgmentWorkbench displayName={user.displayName} />;
}
