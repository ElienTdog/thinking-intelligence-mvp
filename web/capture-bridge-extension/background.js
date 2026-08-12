const DEFAULT_BRIDGE = "http://127.0.0.1:8765";
const openJobs = new Map();

async function settings() {
  return chrome.storage.local.get({ bridgeUrl: DEFAULT_BRIDGE, token: "" });
}

async function bridge(path, options = {}) {
  const config = await settings();
  if (!config.token) throw new Error("请先在扩展选项中保存本机令牌");
  const response = await fetch(`${config.bridgeUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`采集桥返回 ${response.status}`);
  return response.json();
}

async function imageData(url) {
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return null;
    const mimeType = response.headers.get("content-type") || "application/octet-stream";
    if (!mimeType.startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 5_000_000) return null;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return { sourceUrl: url, mimeType, dataBase64: btoa(binary) };
  } catch {
    return null;
  }
}

async function finish(job, payload) {
  const images = [];
  for (const url of payload.imageUrls || []) {
    const captured = await imageData(url);
    if (captured) images.push(captured);
  }
  delete payload.imageUrls;
  await bridge(`/v1/extension/jobs/${job.jobId}/result`, { method: "POST", body: JSON.stringify({ ...payload, sourceUrl: job.sourceUrl, images }) });
}

function extractVisibleWechatArticle() {
  const read = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
  const article = document.querySelector("#js_content");
  const markdown = article?.innerText?.trim() || "";
  const imageUrls = article ? Array.from(article.querySelectorAll("img"))
    .map((image) => image.getAttribute("data-src") || image.getAttribute("src") || "")
    .filter((value, index, all) => /^(https:\/\/|data:image\/)/.test(value) && all.indexOf(value) === index)
    .slice(0, 8) : [];
  if (!article || markdown.length < 400) {
    return {
      status: "needs_user_open",
      sourceUrl: location.href,
      error: "页面未出现可读正文，可能需要登录、验证或在当前浏览器中手动打开",
      evidence: document.title,
    };
  }
  return {
    status: "captured",
    sourceUrl: location.href,
    title: read("#activity-name") || document.title,
    author: read("#js_name"),
    publishedAt: read("#publish_time"),
    markdown,
    html: article.innerHTML,
    imageUrls,
    evidence: "由已授权浏览器中的 #js_content 提取",
  };
}

async function extractFromTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "extract-wechat-article" });
  } catch {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractVisibleWechatArticle,
    });
    if (!injected?.result) throw new Error("扩展未能在微信页面读取正文");
    return injected.result;
  }
}

async function poll() {
  try {
    const { job } = await bridge("/v1/extension/jobs/next");
    if (!job || openJobs.has(job.jobId)) return;
    const tab = await chrome.tabs.create({ url: job.sourceUrl, active: false });
    openJobs.set(job.jobId, tab.id);
    const listener = async (tabId, info) => {
      if (tabId !== tab.id || info.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(listener);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const payload = await extractFromTab(tabId);
        await finish(job, payload);
      } catch (error) {
        await finish(job, { status: "needs_user_open", sourceUrl: job.sourceUrl, error: String(error), evidence: "扩展未能读取文章正文" });
      } finally {
        openJobs.delete(job.jobId);
        await chrome.tabs.remove(tabId).catch(() => {});
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  } catch {
    // The local daemon may be offline; the next alarm retries without changing remote state.
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create("poll-capture-bridge", { periodInMinutes: 0.5 });
  await chrome.runtime.openOptionsPage();
  await poll();
});
chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create("poll-capture-bridge", { periodInMinutes: 0.5 });
  await poll();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "poll-capture-bridge") poll();
});
chrome.alarms.create("poll-capture-bridge", { periodInMinutes: 0.5 });
poll();
