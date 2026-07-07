#!/usr/bin/env python3
"""
语雀 (Yuque) Web API Python 客户端（Cookie 认证）
来源：MetaBlog project/experiments/yuque-api/99_yuque_api_showcase.ipynb
"""

import os
import json
import time
import requests
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# 加载项目根目录 .env
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")


class YuqueClient:
    """语雀 Web API 客户端(Cookie 认证)"""

    BASE_URL = "https://www.yuque.com"

    def __init__(self, session=None, ctoken=None):
        self.session = session or os.environ.get("YUQUE_SESSION")
        self.ctoken = ctoken or os.environ.get("YUQUE_CTOKEN")
        if not self.session:
            raise ValueError("请提供 _yuque_session Cookie 或设置 YUQUE_SESSION 环境变量")
        self.cookies = {
            "_yuque_session": self.session,
            "ctoken": self.ctoken or ""
        }
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.yuque.com",
            "Content-Type": "application/json"
        }
        self.session_req = requests.Session()
        self.session_req.cookies.update(self.cookies)
        self.session_req.headers.update(self.headers)
        self._doc_cache = {}  # 缓存 doc_id -> {slug, book_id}

    def request(self, method, endpoint, **kwargs):
        """发送 HTTP 请求"""
        url = f"{self.BASE_URL}{endpoint}"
        resp = self.session_req.request(method, url, **kwargs)
        resp.raise_for_status()
        return resp.json()

    def health_check(self):
        """健康检查：验证 Cookie 是否有效"""
        try:
            result = self.request("GET", "/api/mine")
            user = result.get("data", {})
            return {
                "ok": True,
                "login": user.get("login"),
                "name": user.get("name"),
                "user_id": user.get("id")
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_user(self):
        return self.request("GET", "/api/mine")

    def get_books(self):
        return self.request("GET", "/api/mine/books")

    def get_docs(self, book_id):
        return self.request("GET", f"/api/docs?book_id={book_id}")

    def get_doc(self, slug, book_id):
        return self.request("GET", f"/api/docs/{slug}?book_id={book_id}")

    def create_doc(self, book_id, title, body="", target_uuid="", doc_type="Doc"):
        """创建文档"""
        payload = {
            "action": "prependChild" if not target_uuid else "prependChild",
            "book_id": book_id,
            "title": title,
            "type": doc_type,
            "insert_to_catalog": True,
            "slug": "",
            "status": 0,
            "body_draft_asl": None
        }
        if target_uuid:
            payload["target_uuid"] = target_uuid
        return self.request("POST", "/api/docs", json=payload)

    def update_doc(self, doc_id, title=None, body=None):
        """更新文档(支持 markdown body)"""
        payload = {}
        if title is not None:
            payload["title"] = title
        if body is not None:
            payload["body"] = body
        return self.request("PUT", f"/api/docs/{doc_id}", json=payload)

    def append_doc_body(self, doc_id, new_content):
        """读取当前文档内容,追加 markdown 文本"""
        doc = self.get_doc_by_id(doc_id)
        current_body = doc.get("body", "") or ""
        updated_body = current_body + "\n\n" + new_content if current_body else new_content
        return self.update_doc(doc_id, body=updated_body)

    def get_doc_by_id(self, doc_id):
        """通过 ID 获取文档(需要先缓存 slug 和 book_id)"""
        if hasattr(self, "_doc_cache") and doc_id in self._doc_cache:
            slug = self._doc_cache[doc_id]["slug"]
            book_id = self._doc_cache[doc_id]["book_id"]
            return self.get_doc(slug, book_id).get("data", {})
        return {}

    def delete_doc(self, doc_id):
        return self.request("DELETE", f"/api/docs/{doc_id}")

    def search(self, query, search_type="content", tab="public", limit=10, page=1):
        """搜索"""
        params = {
            "q": query,
            "type": search_type,  # content, book, user
            "tab": tab,
            "limit": limit,
            "p": page
        }
        return self.request("GET", "/api/zsearch", params=params)

    def lock_doc(self, doc_id, uuid_str):
        return self.request("PUT", f"/api/docs/{doc_id}/lock", json={"uuid": uuid_str})


if __name__ == "__main__":
    client = YuqueClient()
    health = client.health_check()
    print(f"[{'OK' if health['ok'] else 'FAIL'}] YuqueClient initialized")
    if health["ok"]:
        print(f"       Login: {health['login']}")
        print(f"       Name: {health['name']}")
        print(f"       User ID: {health['user_id']}")
    else:
        print(f"       Error: {health.get('error', 'Unknown')}")
