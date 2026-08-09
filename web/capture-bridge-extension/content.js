function text(selector) {
  return document.querySelector(selector)?.textContent?.trim() || "";
}

function articlePayload() {
  const article = document.querySelector("#js_content");
  const markdown = article?.innerText?.trim() || "";
  const images = article ? Array.from(article.querySelectorAll("img"))
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
    title: text("#activity-name") || document.title,
    author: text("#js_name"),
    publishedAt: text("#publish_time"),
    markdown,
    html: article.innerHTML,
    imageUrls: images,
    evidence: "由已授权浏览器中的 #js_content 提取",
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "extract-wechat-article") return false;
  sendResponse(articlePayload());
  return false;
});
