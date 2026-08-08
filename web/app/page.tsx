import type { Metadata } from "next";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import { JudgmentWorkbench } from "./dashboard";

export const metadata: Metadata = {
  title: "思考情报台 | 本地 Wiki 收件箱",
  description: "把来源先写入本地 Wiki，再同步到在线阅读端的私有收件箱。",
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
    return <main className="access-gate"><p className="eyebrow">PRIVATE ALPHA</p><h1>把来源先放进你的本地 Wiki。</h1><p>登录后粘贴链接。可读正文由 Mac 上的本地助手存入 Wiki，再同步回这里阅读；受限网页会留下待剪藏任务。</p><a className="primary link-button" href={chatGPTSignInPath(returnTo)}>使用 ChatGPT 登录</a></main>;
  }
  return <JudgmentWorkbench displayName={user.displayName} />;
}
