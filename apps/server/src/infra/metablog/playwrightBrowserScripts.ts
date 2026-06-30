/**
 * Playwright page.evaluate 浏览器内脚本（字符串形式）
 * tsx 编译箭头函数时会注入 __name，导致 evaluate 在浏览器中报错
 */

export const PW_SCROLL_HALF =
  "(() => { window.scrollTo(0, Math.floor(document.body.scrollHeight / 2)); })()";

export const PW_SCROLL_THIRD =
  "(() => { window.scrollTo(0, Math.floor(document.body.scrollHeight / 3)); })()";

export const PW_EXTRACT_ARTICLE_DOM = `(function(sels) {
  function pickTitle() {
    var h1 = document.querySelector("h1");
    if (h1 && h1.textContent) return h1.textContent.trim();
    var sub = document.querySelector(".article-title, .news-title");
    if (sub && sub.textContent) return sub.textContent.trim();
    return document.title.trim();
  }
  for (var i = 0; i < sels.length; i++) {
    var el = document.querySelector(sels[i]);
    var text = el && el.textContent ? el.textContent.replace(/\\s+/g, " ").trim() : "";
    if (el && text.length >= 120) {
      return { title: pickTitle(), innerHtml: el.innerHTML, textLen: text.length };
    }
  }
  var main = document.querySelector("main, article, .main, #main, .detail, .news-detail") || document.body;
  var bodyText = main && main.innerText ? main.innerText.replace(/\\s+/g, " ").trim() : "";
  if (bodyText.length >= 120) {
    var safe = bodyText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return { title: pickTitle(), innerHtml: "<pre>" + safe + "</pre>", textLen: bodyText.length };
  }
  return null;
})`;

export const PW_EXTRACT_METADATA = `(() => {
  var meta = {};
  document.querySelectorAll("meta[property^='og:'], meta[name^='twitter:'], meta[name='description']").forEach(function(tag) {
    var name = tag.getAttribute("property") || tag.getAttribute("name") || "";
    var content = tag.getAttribute("content") || "";
    if (name && content) meta[name] = content;
  });
  return meta;
})()`;

export const PW_EXTRACT_LINKS = `(() => {
  var links = [];
  document.querySelectorAll("a[href]").forEach(function(a) {
    var href = a.href;
    var text = (a.textContent || "").trim();
    if (href.indexOf("http") === 0 && text) {
      links.push({ text: text.slice(0, 100), href: href });
    }
  });
  return links.slice(0, 100);
})()`;

export const PW_EXTRACT_IMAGES = `(() => {
  var images = [];
  document.querySelectorAll("img[src]").forEach(function(img) {
    var src = img.src;
    var alt = img.alt || "";
    if (src.indexOf("http") === 0) {
      images.push({ alt: alt.slice(0, 100), src: src });
    }
  });
  return images.slice(0, 50);
})()`;

export const PW_EXTRACT_ARTICLE_TEXT = `(() => {
  var selectors = [
    "article",
    "[role='main']",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".content",
    "main"
  ];
  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i]);
    if (el) {
      var text = (el.textContent || "").trim();
      if (text.length > 200) return text;
    }
  }
  var bestText = "";
  document.querySelectorAll("p, div, section").forEach(function(el) {
    var text = (el.textContent || "").trim();
    var children = el.querySelectorAll("p").length;
    if (text.length > bestText.length && children >= 3) {
      bestText = text;
    }
  });
  if (bestText) return bestText;
  return document.body && document.body.textContent ? document.body.textContent.trim() : "";
})()`;

export const PW_BODY_TEXT =
  "(() => document.body && document.body.textContent ? document.body.textContent.trim() : '')()";

/** SPA 站点需更长等待以加载正文 */
export function needsSpaWait(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h.includes("infoq.cn") ||
    h.includes("oschina.net") ||
    h.includes("juejin.cn") ||
    h.includes("csdn.net") ||
    h.includes("segmentfault.com")
  );
}

/** page.waitForFunction 用字符串，避免 tsx __name 注入 */
export const PW_WAIT_BODY_MIN_FN =
  "min => (document.body && document.body.innerText ? document.body.innerText.trim().length : 0) >= min";
