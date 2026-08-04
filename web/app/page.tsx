import type { Metadata } from "next";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import { JudgmentWorkbench } from "./dashboard";

export const metadata: Metadata = {
  title: "思考情报台 | AI 时代知识流",
  description: "一个把可核验来源编译成可刷知识点的私有知识流。",
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
    return <main className="access-gate"><p className="eyebrow">PRIVATE ALPHA</p><h1>把来源变成可追溯的知识点。</h1><p>这是你的私有 AI 知识流。登录后，主动收录来源，或浏览每天由 Raw 层编译出的知识卡。</p><a className="primary link-button" href={chatGPTSignInPath(returnTo)}>使用 ChatGPT 登录</a></main>;
  }
  return <JudgmentWorkbench displayName={user.displayName} />;
}
