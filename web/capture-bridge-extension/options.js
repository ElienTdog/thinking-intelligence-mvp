const bridgeUrl = document.querySelector("#bridgeUrl");
const token = document.querySelector("#token");
const status = document.querySelector("#status");

chrome.storage.local.get({ bridgeUrl: "http://127.0.0.1:8765", token: "" }, (saved) => {
  bridgeUrl.value = saved.bridgeUrl;
  token.value = saved.token;
});

document.querySelector("#save").addEventListener("click", async () => {
  await chrome.storage.local.set({ bridgeUrl: bridgeUrl.value.replace(/\/$/, ""), token: token.value.trim() });
  status.textContent = "已保存";
});
