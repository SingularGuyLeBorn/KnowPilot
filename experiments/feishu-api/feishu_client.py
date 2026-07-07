"""
飞书 Open API Python 客户端
封装 tenant_access_token 认证、Token 缓存、通用 API 调用

参考:
- joeseesun/qiaomu-feishu-lark-agent
- 飞书开放平台文档: https://open.feishu.cn/document/server-docs
"""

import os
import json
import time
import tempfile
import secrets
import threading
import webbrowser
from pathlib import Path
from urllib.parse import urlencode, parse_qs, urlparse
from typing import Optional, Dict, Any, List
import requests
from dotenv import load_dotenv

# 加载项目根目录 .env
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

# OAuth 本地服务器相关(只在 authorize_user 时用到)
try:
    from http.server import HTTPServer, BaseHTTPRequestHandler
except ImportError:
    HTTPServer = None
    BaseHTTPRequestHandler = None

BASE_URL = "https://open.feishu.cn/open-apis"


class FeishuClient:
    """飞书 API 客户端"""

    def __init__(self, app_id: Optional[str] = None, app_secret: Optional[str] = None, user_access_token: Optional[str] = None):
        self.app_id = app_id or os.environ.get("FEISHU_APP_ID") or os.environ.get("LARK_APP_ID")
        self.app_secret = app_secret or os.environ.get("FEISHU_APP_SECRET") or os.environ.get("LARK_APP_SECRET")
        self.user_access_token = user_access_token or os.environ.get("FEISHU_USER_ACCESS_TOKEN")

        if not self.app_id or not self.app_secret:
            raise ValueError(
                "缺少 app_id 或 app_secret. \n"
                "请在 .env 中设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET,\n"
                "或传入参数 FeishuClient(app_id='cli_xxx', app_secret='xxx')"
            )

        # Token 缓存文件
        cache_key = self.app_id[-8:] if len(self.app_id) >= 8 else self.app_id
        self._cache_path = Path(tempfile.gettempdir()) / f".feishu_token_{cache_key}.json"
        self._token: Optional[str] = None
        self._expire_at: float = 0

        # 用户 token 持久化缓存(用于 refresh_token 自动续期,保存到用户目录)
        self._user_token_cache_path = Path.home() / ".feishu_user_token.json"
        self._refresh_token: Optional[str] = None
        self._user_expire_at: float = 0
        self._load_user_token()  # 启动时自动尝试加载持久化的 user token

    # ============ 认证 & Token ============

    def _load_cached_token(self) -> Optional[str]:
        """从缓存文件加载 token"""
        if self._cache_path.exists():
            try:
                data = json.loads(self._cache_path.read_text(encoding="utf-8"))
                if data.get("expire_at", 0) > time.time() + 120:
                    self._token = data["token"]
                    self._expire_at = data["expire_at"]
                    return self._token
            except Exception:
                pass
        return None

    def _save_token(self, token: str, expire: int):
        """保存 token 到缓存文件"""
        self._token = token
        self._expire_at = time.time() + expire
        self._cache_path.write_text(
            json.dumps({"token": token, "expire_at": self._expire_at}, ensure_ascii=False),
            encoding="utf-8"
        )

    def get_tenant_access_token(self, force_refresh: bool = False) -> str:
        """获取 tenant_access_token,带缓存"""
        if not force_refresh and self._token and self._expire_at > time.time() + 120:
            return self._token

        cached = self._load_cached_token()
        if cached and not force_refresh:
            return cached

        resp = requests.post(
            f"{BASE_URL}/auth/v3/tenant_access_token/internal",
            json={"app_id": self.app_id, "app_secret": self.app_secret},
            timeout=30
        )
        data = resp.json()

        if data.get("code", 0) != 0:
            raise RuntimeError(f"获取 token 失败: {data.get('msg')} (code: {data.get('code')})")

        token = data["tenant_access_token"]
        expire = data.get("expire", 7200)
        self._save_token(token, expire)
        return token

    def clear_cache(self):
        """清除 token 缓存"""
        self._token = None
        self._expire_at = 0
        if self._cache_path.exists():
            self._cache_path.unlink()

    # ---------- 用户 Token 持久化(refresh_token 机制) ----------

    def _load_user_token(self) -> None:
        """从本地文件加载 user_access_token 和 refresh_token"""
        if not self._user_token_cache_path.exists():
            return
        try:
            data = json.loads(self._user_token_cache_path.read_text(encoding="utf-8"))
            self.user_access_token = data.get("access_token") or self.user_access_token
            self._refresh_token = data.get("refresh_token")
            self._user_expire_at = data.get("expire_at", 0)
            if self.user_access_token:
                print(f"[Token] 已从本地缓存加载 user_access_token")
        except Exception:
            pass

    def _save_user_token(self, access_token: str, refresh_token: Optional[str] = None,
                         expires_in: int = 7200) -> None:
        """保存 user_access_token 和 refresh_token 到本地文件"""
        self.user_access_token = access_token
        if refresh_token:
            self._refresh_token = refresh_token
        self._user_expire_at = time.time() + expires_in
        try:
            self._user_token_cache_path.write_text(
                json.dumps({
                    "access_token": access_token,
                    "refresh_token": self._refresh_token,
                    "expire_at": self._user_expire_at,
                }, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            print(f"[Token] user_access_token 已持久化到 {self._user_token_cache_path}")
        except Exception as e:
            print(f"[Token] 持久化失败: {e}")

    def refresh_user_token(self) -> Dict[str, Any]:
        """使用 refresh_token 自动续期 user_access_token(无需浏览器)

        前提：
        1. 已通过 OAuth 获取过 refresh_token(authorize_user 会自动保存)
        2. 应用开发者后台 → 安全设置 → 已开启"获取 refresh_token"权限
           (2024年9月23日后新建应用默认关闭,需手动开启)

        返回：
            {"access_token": "...", "refresh_token": "...", "expires_in": 7200, ...}
        """
        if not self._refresh_token:
            raise RuntimeError(
                "没有可用的 refresh_token. \n"
                "请先运行 authorize_user() 走一次 OAuth 授权(需要浏览器),\n"
                "或者确认应用后台已开启 refresh_token 权限. "
            )

        tenant_token = self.get_tenant_access_token()
        print(f"[Refresh] 正在用 refresh_token 续期...")
        resp = requests.post(
            f"{BASE_URL}/authen/v1/refresh_access_token",
            headers={"Authorization": f"Bearer {tenant_token}"},
            json={
                "grant_type": "refresh_token",
                "refresh_token": self._refresh_token,
            },
            timeout=30,
        )
        result = resp.json()
        if result.get("code", 0) != 0:
            error_msg = result.get("msg", "Unknown error")
            # 如果 refresh_token 过期或失效,提示重新授权
            if result.get("code") in (99991677, 99991663, 99991661):
                raise RuntimeError(
                    f"refresh_token 已失效({error_msg}),需要重新走 OAuth 授权. \n"
                    f"请运行 client.authorize_user() 重新获取. "
                )
            raise RuntimeError(f"刷新 token 失败: {error_msg} (code: {result.get('code')})")

        data = result.get("data", result)
        new_access = data.get("access_token", "")
        new_refresh = data.get("refresh_token")
        expires_in = data.get("expires_in", 7200)

        self._save_user_token(new_access, new_refresh, expires_in)
        print(f"[Refresh] user_access_token 续期成功,有效期 {expires_in}s")
        return data

    def ensure_user_token(self, auto_refresh: bool = True) -> str:
        """确保 user_access_token 有效,过期时自动刷新

        参数:
            auto_refresh: 是否自动用 refresh_token 续期,默认 True

        返回:
            有效的 user_access_token
        """
        if self.user_access_token and self._user_expire_at > time.time() + 60:
            return self.user_access_token

        if auto_refresh and self._refresh_token:
            self.refresh_user_token()
            return self.user_access_token

        raise RuntimeError(
            "user_access_token 已过期或不存在,且无法自动刷新. \n"
            "请运行 client.authorize_user() 重新获取. "
        )

    # ============ OAuth 用户授权(获取 user_access_token) ============

    def authorize_user(
        self,
        redirect_uri: str = "http://localhost:8088",
        port: int = 8088,
        timeout: int = 120,
        scope: str = "offline_access",
    ) -> Dict[str, Any]:
        """通过飞书 OAuth 授权流程获取 user_access_token. 

        流程：
        1. 生成授权链接,自动打开浏览器(或打印链接让用户点击)
        2. 启动本地 HTTP 服务器监听回调
        3. 用户扫码授权后,飞书重定向到 localhost 并带上 code
        4. 用 code 换取 access_token 和 refresh_token
        5. 自动更新 client.user_access_token

        前提：
        - 在飞书开放平台 → 应用详情 → 安全设置 → 重定向 URL 中添加 redirect_uri
        - 应用已发布或处于测试状态

        参数:
            redirect_uri: 回调地址(默认 http://localhost:8088)
            port: 本地监听端口
            timeout: 等待授权的最大秒数
            scope: 授权范围,默认 offline_access(可刷新 token)

        返回:
            {"access_token": "...", "refresh_token": "...", "expires_in": 7200, ...}
        """
        if HTTPServer is None:
            raise RuntimeError("当前环境不支持 http.server,无法启动本地授权服务")

        state = secrets.token_urlsafe(16)
        auth_url = (
            f"https://accounts.feishu.cn/open-apis/authen/v1/authorize?"
            f"app_id={self.app_id}"
            f"&redirect_uri={redirect_uri}"
            f"&scope={scope.replace(' ', '%20')}"
            f"&state={state}"
        )

        result_container: Dict[str, Any] = {"done": False, "error": None, "data": None}
        # 闭包引用外部 client 的 app_id/app_secret(OAuthHandler 的 self 不是 client)
        _app_id = self.app_id
        _app_secret = self.app_secret

        class OAuthHandler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                pass  # 静默日志

            def do_GET(self):
                # 忽略浏览器自动请求的 favicon,避免干扰主流程
                if self.path == "/favicon.ico":
                    self.send_response(404)
                    self.end_headers()
                    return
                print(f"[OAuth Server] 收到请求: {self.path[:80]}")
                try:
                    parsed = urlparse(self.path)
                    query = parse_qs(parsed.query)

                    code = query.get("code", [None])[0]
                    returned_state = query.get("state", [None])[0]
                    print(f"[OAuth Server] code={code is not None}, state_match={returned_state == state}")

                    if code and returned_state == state:
                        # 用 code 换取 token
                        try:
                            print(f"[OAuth Server] 正在用 code 换取 token...")
                            resp = requests.post(
                                f"{BASE_URL}/authen/v2/oauth/token",
                                json={
                                    "grant_type": "authorization_code",
                                    "client_id": _app_id,
                                    "client_secret": _app_secret,
                                    "code": code,
                                    "redirect_uri": redirect_uri,
                                },
                                timeout=30,
                            )
                            token_resp = resp.json()
                            print(f"[OAuth Server] 飞书返回: code={token_resp.get('code')}")
                            if token_resp.get("code", 0) != 0:
                                error_msg = token_resp.get("msg", "Unknown error")
                                result_container["error"] = f"换取 token 失败: {error_msg}"
                                self._send_response(
                                    f"<h2 style='color:red'>授权失败</h2><p>{error_msg}</p>",
                                    status=400,
                                )
                            else:
                                data = token_resp.get("data", token_resp)
                                result_container["data"] = data
                                token = data.get("access_token", "")
                                print(f"[OAuth Server] Token 获取成功, 设置 done=True")
                                self._send_response(
                                    "<h2 style='color:green'>✅ 授权成功</h2>"
                                    "<p>user_access_token 已获取,可以关闭此页面. </p>"
                                    f"<p>Token: <code>{token[:20]}...</code></p>",
                                    script=f"console.log('[Feishu] user_access_token:', '{token}');",
                                )
                        except Exception as e:
                            result_container["error"] = str(e)
                            print(f"[OAuth Server] 异常: {e}")
                            self._send_response(
                                f"<h2 style='color:red'>服务器错误</h2><p>{e}</p>", status=500
                            )
                    else:
                        result_container["error"] = "授权失败：缺少 code 或 state 不匹配"
                        print(f"[OAuth Server] 缺少 code 或 state 不匹配")
                        self._send_response(
                            "<h2 style='color:red'>授权失败</h2><p>缺少授权码或 state 不匹配</p>",
                            status=400,
                        )
                finally:
                    result_container["done"] = True
                    print(f"[OAuth Server] done=True, error={result_container['error'] is not None}, data={result_container['data'] is not None}")

            def _send_response(self, html_body: str, status: int = 200, script: str = ""):
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                script_tag = f"<script>{script}</script>" if script else ""
                self.wfile.write(
                    f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>飞书授权</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px">
{html_body}
{script_tag}
</body></html>""".encode("utf-8")
                )

        # 启动本地服务器(允许端口复用,避免上一次未释放导致绑定失败)
        class ReusableHTTPServer(HTTPServer):
            allow_reuse_address = True

        server = ReusableHTTPServer(("127.0.0.1", port), OAuthHandler)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()

        print(f"\n[OAuth] 本地服务器已启动: http://127.0.0.1:{port}")
        print(f"[OAuth] 请在浏览器中打开以下链接并扫码授权:\n")
        print(f"    {auth_url}\n")

        # 尝试自动打开浏览器
        try:
            webbrowser.open(auth_url)
            print("[OAuth] 已尝试自动打开浏览器")
        except Exception:
            pass

        # 等待回调或超时
        start = time.time()
        elapsed = 0
        while not result_container["done"] and elapsed < timeout:
            time.sleep(0.5)
            elapsed = time.time() - start
            if int(elapsed) % 5 == 0 and int(elapsed) > 0:
                print(f"[OAuth] 等待中... {int(elapsed)}s")

        print(f"[OAuth] 循环结束: done={result_container['done']}, elapsed={int(elapsed)}s")
        try:
            server.shutdown()
            print(f"[OAuth] server.shutdown() 完成")
        except Exception as e:
            print(f"[OAuth] server.shutdown() 异常: {e}")
        try:
            server_thread.join(timeout=2)
            print(f"[OAuth] server_thread.join() 完成, alive={server_thread.is_alive()}")
        except Exception as e:
            print(f"[OAuth] server_thread.join() 异常: {e}")

        if not result_container["done"]:
            raise RuntimeError(
                f"授权超时({timeout}s). 请确认：\n"
                f"  1. 已在安全设置中添加重定向 URL: {redirect_uri}\n"
                f"  2. 点击了授权链接并完成扫码\n"
                f"  3. 应用已发布或处于测试状态"
            )

        if result_container["error"]:
            raise RuntimeError(result_container["error"])

        data = result_container["data"]
        access_token = data.get("access_token", "")
        refresh_token = data.get("refresh_token")
        expires_in = data.get("expires_in", 7200)
        self._save_user_token(access_token, refresh_token, expires_in)
        print(f"[OAuth] Token 已保存到 client.user_access_token")
        if refresh_token:
            print(f"[OAuth] refresh_token 已保存,后续可调用 refresh_user_token() 自动续期")
        else:
            print(f"[WARN] 未获取到 refresh_token！")
            print(f"       2024年9月23日后新建的应用默认不返回 refresh_token. ")
            print(f"       请在飞书开放平台 → 应用详情 → 安全设置 → 开启'获取 refresh_token'权限. ")
        return data

    # ============ 通用 API 调用 ============

    def request(
        self,
        method: str,
        path: str,
        json_data: Optional[Dict] = None,
        params: Optional[Dict] = None,
        files: Optional[Dict] = None,
        data: Optional[Dict] = None,
        timeout: int = 30,
        use_user_token: bool = False,
    ) -> Dict[str, Any]:
        """发送飞书 API 请求

        参数:
            use_user_token: 是否使用 user_access_token(而非 tenant_access_token). 
                            创建 Wiki 知识库等 API 必须使用 user_access_token. 
        """
        if use_user_token:
            token = self.user_access_token
            if not token:
                raise RuntimeError(
                    "该 API 需要 user_access_token. \n"
                    "请在初始化时传入 user_access_token,或在 .env 中设置 FEISHU_USER_ACCESS_TOKEN. \n"
                    "获取方式：登录飞书开放平台 → 你的应用 → API 调试台 → 获取 Token"
                )
        elif self.user_access_token and path.startswith('/wiki/'):
            # Wiki 相关 API：如果配置了 user_access_token,优先使用它. 
            # 因为用 user token 创建的知识库,tenant token 默认没有访问权限. 
            token = self.user_access_token
        else:
            token = self.get_tenant_access_token()
        url = f"{BASE_URL}{path}"

        # 飞书 docx API 需要 document_revision_id,默认 -1 忽略版本锁
        if params is None:
            params = {}
        if '/docx/v1/documents/' in path and 'document_revision_id' not in params:
            params['document_revision_id'] = '-1'
        if params:
            # 过滤 None 值
            params = {k: v for k, v in params.items() if v is not None}
            url += "?" + urlencode(params)

        headers = {"Authorization": f"Bearer {token}"}

        if files:
            # multipart/form-data 上传文件(可同时传 data form fields)
            resp = requests.request(method, url, headers=headers, files=files, data=data, timeout=timeout)
        elif json_data is not None:
            headers["Content-Type"] = "application/json"
            resp = requests.request(method, url, headers=headers, json=json_data, timeout=timeout)
        elif data is not None:
            resp = requests.request(method, url, headers=headers, data=data, timeout=timeout)
        else:
            resp = requests.request(method, url, headers=headers, timeout=timeout)

        try:
            result_data = resp.json()
        except Exception:
            result_data = {"raw_text": resp.text, "status_code": resp.status_code}

        return result_data

    def api(self, method: str, path: str, retries: int = 2, **kwargs) -> Any:
        """发送 API 请求并自动检查错误码,返回 data 字段
        
        对可重试错误(429/502/503/504)自动重试,指数退避. 
        """
        import time
        import random
        last_error = None
        for attempt in range(retries + 1):
            try:
                result = self.request(method, path, **kwargs)
                code = result.get("code", 0)
                if code != 0:
                    # 可重试错误码
                    if code in (429, 502, 503, 504) and attempt < retries:
                        delay = (2 ** attempt) + random.uniform(0, 1)
                        time.sleep(delay)
                        continue
                    raise RuntimeError(f"API 错误 {code}: {result.get('msg')} | path={path}")
                return result.get("data", result)
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                last_error = e
                if attempt < retries:
                    delay = (2 ** attempt) + random.uniform(0, 1)
                    time.sleep(delay)
                    continue
                raise RuntimeError(f"请求失败(已重试 {retries} 次): {e} | path={path}")
        raise RuntimeError(f"请求失败: {last_error} | path={path}")

    # ============ 便捷方法 ============

    def upload_image(self, document_id: str, image_path: str) -> Dict[str, Any]:
        """
        上传图片到飞书文档素材库

        参数:
            document_id: 飞书文档 ID(docx 的 document_id)
            image_path: 本地图片文件路径

        返回:
            { file_token: "boxcnxxx" }
        """
        from pathlib import Path
        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"图片文件不存在: {image_path}")

        file_size = path.stat().st_size
        ext = path.suffix.lstrip(".").lower()
        mime_type = {
            "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "gif": "image/gif",
            "webp": "image/webp", "bmp": "image/bmp",
        }.get(ext, "image/png")

        with open(path, "rb") as f:
            files = {
                "file": (path.name, f, mime_type),
            }
            form_data = {
                "file_name": path.name,
                "parent_type": "doc_image",
                "parent_node": document_id,
                "size": str(file_size),
            }
            result = self.request("POST", "/drive/v1/medias/upload_all", files=files, data=form_data)

        if result.get("code", 0) != 0:
            raise RuntimeError(f"上传失败: {result.get('msg')} (code: {result.get('code')})")
        return {"file_token": result["data"]["file_token"]}

    def health_check(self) -> Dict:
        """健康检查：尝试获取 token 并返回状态"""
        try:
            token = self.get_tenant_access_token()
            return {
                "ok": True,
                "token_valid": bool(token),
                "expire_at": self._expire_at,
                "expire_in": int(self._expire_at - time.time()),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ============ Wiki 知识库 API ============

    def create_wiki_space(self, name: str, description: Optional[str] = None,
                          use_user_token: bool = True) -> Dict[str, Any]:
        """
        创建知识库空间(Wiki Space)

        【重要】此 API 默认使用 user_access_token. 若传 use_user_token=False,
        将尝试使用 tenant_access_token(通常会因权限不足而失败). 
        请在初始化时传入 user_access_token 或在 .env 中设置 FEISHU_USER_ACCESS_TOKEN. 

        参数:
            name: 知识库名称
            description: 知识库描述
            use_user_token: 是否使用 user_access_token,默认 True

        返回:
            { space: { space_id, name, description, ... } }
        """
        payload = {"name": name}
        if description:
            payload["description"] = description
        return self.api("POST", "/wiki/v2/spaces", json_data=payload, use_user_token=use_user_token)

    def list_wiki_spaces(self, page_size: int = 10) -> List[Dict[str, Any]]:
        """
        获取知识库空间列表(自动翻页获取全部)

        参数:
            page_size: 每页数量 (1-50)

        返回:
            知识库空间列表
        """
        all_items = []
        page_token = None
        while True:
            params: Dict[str, Any] = {"page_size": page_size}
            if page_token:
                params["page_token"] = page_token
            result = self.api("GET", "/wiki/v2/spaces", params=params)
            items = result.get("items", [])
            all_items.extend(items)
            if not result.get("has_more"):
                break
            page_token = result.get("page_token")
        return all_items

    def get_wiki_space(self, space_id: str) -> Dict[str, Any]:
        """
        获取知识库空间详情

        参数:
            space_id: 知识库空间 ID
        """
        return self.api("GET", f"/wiki/v2/spaces/{space_id}")

    def update_wiki_space(self, space_id: str, name: Optional[str] = None,
                          description: Optional[str] = None) -> Dict[str, Any]:
        """
        更新知识库空间信息

        参数:
            space_id: 知识库空间 ID
            name: 新名称
            description: 新描述
        """
        payload = {}
        if name is not None:
            payload["name"] = name
        if description is not None:
            payload["description"] = description
        return self.api("PUT", f"/wiki/v2/spaces/{space_id}", json_data=payload)

    def delete_wiki_space(self, space_id: str) -> Dict[str, Any]:
        """
        删除知识库空间

        参数:
            space_id: 知识库空间 ID

        返回:
            API 返回结果
        """
        return self.api("DELETE", f"/wiki/v2/spaces/{space_id}", use_user_token=True)

    def list_wiki_nodes(self, space_id: str, parent_node_token: Optional[str] = None,
                        page_size: int = 10) -> List[Dict[str, Any]]:
        """
        获取知识库节点列表(自动翻页获取全部)

        参数:
            space_id: 知识库空间 ID
            parent_node_token: 父节点 token,不传则获取根节点
            page_size: 每页数量

        返回:
            节点列表,每项包含 node_token, obj_type, title, has_child 等
        """
        all_items = []
        page_token = None
        while True:
            params: Dict[str, Any] = {"page_size": page_size}
            if parent_node_token:
                params["parent_node_token"] = parent_node_token
            if page_token:
                params["page_token"] = page_token
            result = self.api("GET", f"/wiki/v2/spaces/{space_id}/nodes", params=params)
            items = result.get("items", [])
            all_items.extend(items)
            if not result.get("has_more"):
                break
            page_token = result.get("page_token")
        return all_items

    def create_wiki_node(self, space_id: str, node_type: str = "origin",
                         obj_type: str = "docx", parent_node_token: Optional[str] = None,
                         title: Optional[str] = None,
                         node_token: Optional[str] = None) -> Dict[str, Any]:
        """
        在知识库中创建节点

        参数:
            space_id: 知识库空间 ID
            node_type: 节点类型,默认 "origin"(普通节点)
            obj_type: 对象类型,默认 "docx"
            parent_node_token: 父节点 token,不传则挂载到根节点
            title: 节点标题(创建 docx 时需要)
            node_token: 指定节点 token(可选)

        返回:
            { node: { node_token, obj_token, ... } }
        """
        payload: Dict[str, Any] = {"node_type": node_type, "obj_type": obj_type}
        if parent_node_token:
            payload["parent_node_token"] = parent_node_token
        if title:
            payload["title"] = title
        if node_token:
            payload["node_token"] = node_token
        return self.api("POST", f"/wiki/v2/spaces/{space_id}/nodes", json_data=payload)

    def move_wiki_node(self, space_id: str, node_token: str,
                       parent_node_token: Optional[str] = None) -> Dict[str, Any]:
        """
        移动知识库节点

        参数:
            space_id: 知识库空间 ID
            node_token: 要移动的节点 token
            parent_node_token: 目标父节点 token,不传则移动到根节点
        """
        payload: Dict[str, Any] = {}
        if parent_node_token:
            payload["target_parent_token"] = parent_node_token
        return self.api("POST", f"/wiki/v2/spaces/{space_id}/nodes/{node_token}/move", json_data=payload, use_user_token=True)

    def move_doc_to_wiki(self, space_id: str, obj_token: str,
                         parent_wiki_token: Optional[str] = None) -> Dict[str, Any]:
        """
        将已有云文档迁移/挂载到知识库

        【注意】此接口为异步接口,成功时返回 task_id. 需要调用 get_wiki_task 轮询状态,
        从 move_result[0].node.node_token 获取迁入后的节点 token. 

        参数:
            space_id: 知识库空间 ID
            obj_token: 文档 obj_token(如 docx 的 document_id)
            parent_wiki_token: 目标父节点 wiki_token,不传则挂载到根节点

        返回:
            { "task_id": "xxx" }
        """
        payload: Dict[str, Any] = {"obj_token": obj_token, "obj_type": "docx"}
        if parent_wiki_token:
            payload["parent_wiki_token"] = parent_wiki_token
        return self.api("POST", f"/wiki/v2/spaces/{space_id}/nodes/move_docs_to_wiki", json_data=payload, use_user_token=True)

    def get_wiki_task(self, task_id: str, task_type: str = "move", max_retry: int = 10) -> Dict[str, Any]:
        """
        轮询查询 Wiki 异步任务状态

        参数:
            task_id: 任务 ID
            task_type: 任务类型,默认 "move"
            max_retry: 最大轮询次数,默认 10

        返回:
            move_result 列表,成功时 status=0,可从 move_result[0].node 获取节点信息
        """
        for i in range(max_retry):
            result = self.api("GET", f"/wiki/v2/tasks/{task_id}", params={"task_type": task_type}, use_user_token=True)
            task = result.get("task", {})
            move_result = task.get("move_result", [])
            if move_result:
                status = move_result[0].get("status")
                if status == 0:
                    return move_result[0]
                elif status == -1:
                    raise RuntimeError(f"迁入任务失败: {move_result[0].get('status_msg', 'unknown')}")
            time.sleep(1)
        raise RuntimeError(f"迁入任务超时,task_id: {task_id}")

    def delete_wiki_node(self, space_id: str, node_token: str) -> Dict[str, Any]:
        """
        删除知识库节点

        参数:
            space_id: 知识库空间 ID
            node_token: 节点 token
        """
        return self.api("DELETE", f"/wiki/v2/spaces/{space_id}/nodes/{node_token}")

    def list_wiki_members(self, space_id: str, page_size: int = 100) -> List[Dict[str, Any]]:
        """
        获取知识库成员列表

        参数:
            space_id: 知识库空间 ID
            page_size: 每页数量

        返回:
            成员列表
        """
        result = self.api("GET", f"/wiki/v2/spaces/{space_id}/members", params={"page_size": page_size})
        return result.get("items", [])

    def add_wiki_member(self, space_id: str, member_type: str, member_id: str,
                        perm: str = "view") -> Dict[str, Any]:
        """
        添加知识库成员

        参数:
            space_id: 知识库空间 ID
            member_type: 成员类型,"user" 或 "chat"
            member_id: 成员 open_id 或 chat_id
            perm: 权限,"view"(可阅读)或 "edit"(可编辑)
        """
        payload = {
            "member_type": member_type,
            "member_id": member_id,
            "perm": perm,
        }
        return self.api("POST", f"/wiki/v2/spaces/{space_id}/members", json_data=payload)

    def remove_wiki_member(self, space_id: str, member_id: str) -> None:
        """
        移除知识库成员

        参数:
            space_id: 知识库空间 ID
            member_id: 成员 ID
        """
        self.api("DELETE", f"/wiki/v2/spaces/{space_id}/members/{member_id}")

    # ============ 文档权限操作 ============

    def share_doc(self, document_id: str, member_id: str, member_type: str = "openid",
                  perm: str = "full_access") -> Dict[str, Any]:
        """
        分享飞书文档权限给指定用户

        参数:
            document_id: 飞书文档 ID
            member_id: 用户标识(open_id / 邮箱 / 手机号)
            member_type: 用户标识类型,默认 openid
            perm: 权限级别,默认 full_access
        """
        return self.api("POST", f"/drive/v1/permissions/{document_id}/members", json_data={
            "member_type": member_type,
            "member_id": member_id,
            "perm": perm,
        }, params={"type": "docx"})

    def unshare_doc(self, document_id: str, member_id: str, member_type: str = "openid") -> Dict[str, Any]:
        """
        取消飞书文档对指定用户的权限分享

        参数:
            document_id: 飞书文档 ID
            member_id: 用户标识
            member_type: 用户标识类型,默认 openid
        """
        return self.api("DELETE", f"/drive/v1/permissions/{document_id}/members/{member_id}",
                        params={"type": "docx", "member_type": member_type})

    # ============ 消息操作 ============

    def send_im(self, receive_id: str, content: str, msg_type: str = "text",
                receive_id_type: str = "open_id") -> Dict[str, Any]:
        """
        发送飞书即时消息

        参数:
            receive_id: 接收者 ID
            content: 消息内容
            msg_type: 消息类型,默认 text
            receive_id_type: 接收者 ID 类型,默认 open_id
        """
        message_content = content
        if msg_type == "text" and not content.startswith("{"):
            import json as _json
            message_content = _json.dumps({"text": content})
        return self.api("POST", "/im/v1/messages", json_data={
            "receive_id": receive_id,
            "msg_type": msg_type,
            "content": message_content,
        }, params={"receive_id_type": receive_id_type})

    # ============ 用户操作 ============

    def search_user_keyword(self, query: str, page_size: int = 20) -> Dict[str, Any]:
        """
        按关键词搜索飞书用户(姓名、部门等)

        参数:
            query: 搜索关键词
            page_size: 每页数量
        """
        return self.api("GET", "/contact/v3/users", params={"query": query, "page_size": str(page_size)})

    # ============ 文档搜索与块操作 ============

    def search_docs(self, search_key: str, count: int = 20) -> Dict[str, Any]:
        """
        在飞书云空间中搜索文档

        参数:
            search_key: 搜索关键词
            count: 返回结果数量,最大 50
        """
        return self.api("POST", "/suite/docs-api/search/object", json_data={
            "search_key": search_key,
            "count": min(count, 50),
        })

    def get_doc_blocks(self, document_id: str, page_size: int = 500) -> Dict[str, Any]:
        """
        获取飞书文档的块结构列表

        参数:
            document_id: 文档 ID
            page_size: 每页块数量
        """
        return self.api("GET", f"/docx/v1/documents/{document_id}/blocks", params={"page_size": str(page_size)})

    def update_doc_block(self, document_id: str, block_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        更新飞书文档中的指定块内容

        参数:
            document_id: 文档 ID
            block_id: 块 ID
            update_data: 更新内容,如 {"update_text_elements": {"elements": [...]}}
        """
        return self.api("PATCH", f"/docx/v1/documents/{document_id}/blocks/{block_id}", json_data=update_data)

    def delete_doc_block(self, document_id: str, block_id: str) -> Dict[str, Any]:
        """
        删除飞书文档中的指定块

        参数:
            document_id: 文档 ID
            block_id: 块 ID
        """
        # 1. 获取父块的所有子块,查找目标索引
        list_result = self.api("GET", f"/docx/v1/documents/{document_id}/blocks/{document_id}/children",
                               params={"page_size": "500"})
        items = list_result.get("items", [])
        index = next((i for i, item in enumerate(items) if item.get("block_id") == block_id), -1)
        if index == -1:
            raise RuntimeError(f"未找到指定 block_id 的块: {block_id}")
        # 2. 调用 batch_delete 按索引删除
        return self.api("DELETE", f"/docx/v1/documents/{document_id}/blocks/{document_id}/children/batch_delete",
                        json_data={"start_index": index, "end_index": index + 1})

    # ============ 图片插入(三步法封装) ============

    def insert_image_to_doc(self, document_id: str, image_url: Optional[str] = None,
                            image_base64: Optional[str] = None, file_name: str = "image.png",
                            caption: Optional[str] = None) -> Dict[str, Any]:
        """
        插入图片到飞书文档(完整三步法封装)

        参数:
            document_id: 飞书文档 ID
            image_url: 网络图片 URL(与 image_base64 二选一)
            image_base64: Base64 编码的图片数据(与 image_url 二选一)
            file_name: 图片文件名
            caption: 图注文字(可选)
        """
        import time
        # Step 1: 创建空图片块
        empty_image_block = {"block_type": 27, "image": {}}
        children = [empty_image_block]
        if caption:
            children.insert(0, {"block_type": 2, "text": {"elements": [{"text_run": {"content": caption}}]}})
        create_result = self.api("POST",
                                 f"/docx/v1/documents/{document_id}/blocks/{document_id}/children",
                                 json_data={"children": children})
        image_block_result = next((c for c in create_result.get("children", []) if c.get("block_type") == 27), None)
        if not image_block_result:
            raise RuntimeError("创建图片块后未返回 block_id")
        image_block_id = image_block_result["block_id"]

        time.sleep(0.5)

        # Step 2: 准备图片数据
        if image_url:
            img_res = requests.get(image_url, timeout=30)
            img_res.raise_for_status()
            image_buffer = img_res.content
            final_file_name = image_url.split('/')[-1].split('?')[0] or file_name
        elif image_base64:
            import base64
            base64_data = image_base64.replace("data:image/", "")
            if ";base64," in base64_data:
                base64_data = base64_data.split(";base64,")[1]
            image_buffer = base64.b64decode(base64_data)
            final_file_name = file_name
        else:
            raise ValueError("需要提供 image_url 或 image_base64")

        # Step 3: 上传素材
        form_data = {
            "file_name": final_file_name,
            "parent_type": "docx_image",
            "parent_node": image_block_id,
            "size": str(len(image_buffer)),
        }
        files = {"file": (final_file_name, image_buffer, "image/png")}
        upload_result = self.request("POST", "/drive/v1/medias/upload_all", files=files, data=form_data)
        if upload_result.get("code", 0) != 0:
            raise RuntimeError(f"上传素材失败: {upload_result.get('msg')}")
        file_token = upload_result.get("data", {}).get("file_token")

        # Step 4: PATCH 绑定图片
        self.api("PATCH", f"/docx/v1/documents/{document_id}/blocks/{image_block_id}",
                 json_data={"replace_image": {"token": file_token}})

        return {
            "code": 0,
            "msg": "success",
            "data": {"block_id": image_block_id, "file_token": file_token},
        }


# ============ Markdown → 飞书块 转换器 (Robust版,与TS对齐) ============

import re as _re

_ZERO_WIDTH_CHARS = _re.compile(r'[\u200B-\u200D\uFEFF\u2060]')
_HEADING_RE = _re.compile(r'^(#{1,9})\s+(.+?)(?:\s+#*)?$')
_BULLET_RE = _re.compile(r'^(\s*)-\s+(.+)$')
_ORDERED_RE = _re.compile(r'^(\s*)(\d+)\.\s+(.+)$')
_TODO_RE = _re.compile(r'^(\s*)-\s+\[([ xX])\]\s+(.+)$')
_DIVIDER_RE = _re.compile(r'^(---+|\*\*\*|___|\*\s+\*\s+\*)\s*$')
_CODE_FENCE_RE = _re.compile(r'^```(.*)$')


def md_to_blocks(markdown: str) -> List[Dict[str, Any]]:
    """
    将 Markdown 文本转换为飞书 docx v1 块格式(鲁棒版)

    支持的语法:
    - 块级: 标题(1-9)、无序/有序列表、任务列表、代码块、引用、分割线、表格、公式块
    - 行内: 粗体、斜体、删除线、行内代码、链接、公式
    """
    cleaned = _clean_input(markdown)
    blocks = _parse_blocks(cleaned)
    return [_merge_block_text_elements(b) for b in blocks]


def _clean_input(text: str) -> str:
    text = text.lstrip('\ufeff')
    text = _ZERO_WIDTH_CHARS.sub('', text)
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    return text


def _parse_blocks(markdown: str) -> List[Dict[str, Any]]:
    lines = markdown.split('\n')
    blocks: List[Dict[str, Any]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line or line.strip() == '':
            i += 1
            continue
        try:
            result = _parse_block(lines, i)
            blocks.append(result['block'])
            i = result['next_index']
        except Exception:
            para_lines = [line]
            i += 1
            while i < len(lines) and lines[i].strip() != '' and not _is_block_start(lines[i]):
                para_lines.append(lines[i])
                i += 1
            blocks.append({
                'block_type': 2,
                'text': {'elements': [{'text_run': {'content': '\n'.join(para_lines)}}]},
            })
    return blocks


def _parse_block(lines, i):
    line = lines[i]

    if line == '$$':
        formula_lines = []
        i += 1
        while i < len(lines) and lines[i] != '$$':
            formula_lines.append(lines[i])
            i += 1
        return {
            'block': {
                'block_type': 2,
                'text': {'elements': [{'equation': {'content': '\n'.join(formula_lines)}}]},
            },
            'next_index': i + 1,
        }

    m = _re.match(r'^\$\$(.+)\$\$$', line)
    if m:
        return {
            'block': {
                'block_type': 2,
                'text': {'elements': [{'equation': {'content': m.group(1)}}]},
            },
            'next_index': i + 1,
        }

    cm = _CODE_FENCE_RE.match(line)
    if cm:
        lang = cm.group(1).strip()
        code_lines = []
        i += 1
        while i < len(lines) and not _CODE_FENCE_RE.match(lines[i]):
            code_lines.append(lines[i])
            i += 1
        block = {
            'block_type': 14,
            'code': {'elements': [{'text_run': {'content': '\n'.join(code_lines)}}]},
        }
        if lang:
            block['code']['style'] = {'language': _map_code_language(lang)}
        return {'block': block, 'next_index': i + 1}

    hm = _HEADING_RE.match(line)
    if hm:
        level = min(len(hm.group(1)), 9)
        return {
            'block': {
                'block_type': 2 + level,
                f'heading{level}': {
                    'elements': _parse_inline_elements(hm.group(2)),
                },
            },
            'next_index': i + 1,
        }

    tm = _TODO_RE.match(line)
    if tm:
        return {
            'block': {
                'block_type': 17,
                'todo': {
                    'elements': _parse_inline_elements(tm.group(3)),
                    'style': {'done': tm.group(2).lower() == 'x'},
                },
            },
            'next_index': i + 1,
        }

    bm = _BULLET_RE.match(line)
    if bm:
        return {
            'block': {
                'block_type': 12,
                'bullet': {'elements': _parse_inline_elements(bm.group(2))},
            },
            'next_index': i + 1,
        }

    om = _ORDERED_RE.match(line)
    if om:
        return {
            'block': {
                'block_type': 13,
                'ordered': {'elements': _parse_inline_elements(om.group(3))},
            },
            'next_index': i + 1,
        }

    if line.startswith('>'):
        quote_lines = []
        while i < len(lines) and lines[i].startswith('>'):
            stripped = _re.sub(r'^>\s?', '', lines[i])
            quote_lines.append(stripped)
            i += 1
        return {
            'block': {
                'block_type': 15,
                'quote': {'elements': _parse_inline_elements('\n'.join(quote_lines))},
            },
            'next_index': i,
        }

    if _DIVIDER_RE.match(line):
        return {'block': {'block_type': 22, 'divider': {}}, 'next_index': i + 1}

    if _is_table_line(line) and i + 1 < len(lines) and _is_table_divider(lines[i + 1]):
        table_lines = [line]
        i += 1
        while i < len(lines) and _is_table_line(lines[i]):
            table_lines.append(lines[i])
            i += 1
        parsed = _parse_markdown_table(table_lines)
        if parsed:
            return {'block': parsed, 'next_index': i}
        return {
            'block': {
                'block_type': 2,
                'text': {'elements': [{'text_run': {'content': '\n'.join(table_lines)}}]},
            },
            'next_index': i,
        }

    para_lines = [line]
    i += 1
    while i < len(lines) and lines[i].strip() != '' and not _is_block_start(lines[i]):
        para_lines.append(lines[i])
        i += 1
    return {
        'block': {
            'block_type': 2,
            'text': {'elements': _parse_inline_elements('\n'.join(para_lines))},
        },
        'next_index': i,
    }


def _is_block_start(line):
    return (
        line == '$$' or
        _re.match(r'^\$\$.+\$\$$', line) is not None or
        _HEADING_RE.match(line) is not None or
        _CODE_FENCE_RE.match(line) is not None or
        _TODO_RE.match(line) is not None or
        _BULLET_RE.match(line) is not None or
        _ORDERED_RE.match(line) is not None or
        line.startswith('>') or
        _DIVIDER_RE.match(line) is not None or
        _is_table_line(line)
    )


def _is_table_line(line):
    return bool(_re.match(r'^\s*\|', line)) or bool(_re.search(r'\|\s*$', line))


def _is_table_divider(line):
    return bool(_re.match(r'^\s*\|?[-:\|\s]+\|?\s*$', line))


def _parse_markdown_table(lines):
    if len(lines) < 2:
        return None
    header_cells = _split_table_cells(lines[0])
    col_count = len(header_cells)
    if col_count == 0:
        return None
    if not _is_table_divider(lines[1]):
        return None
    cell_contents = []
    for cell in header_cells:
        cell_contents.append(_parse_inline_elements(cell))
    for r in range(2, len(lines)):
        cells = _split_table_cells(lines[r])
        for c in range(col_count):
            cell_contents.append(_parse_inline_elements(cells[c] if c < len(cells) else ''))
    row_count = len(lines) - 1
    return {
        'block_type': 31,
        'table': {
            'property': {
                'column_size': col_count,
                'row_size': row_count,
            },
        },
        '_cell_contents': cell_contents,
    }


def _split_table_cells(line):
    content = line.strip()
    if content.startswith('|'):
        content = content[1:]
    if content.endswith('|'):
        content = content[:-1]
    return [s.strip() for s in content.split('|')]


def _parse_inline_elements(text):
    return _parse_inline(text, 0)


def _parse_inline(text, start):
    elements = []
    i = start
    while i < len(text):
        link = _try_parse_link(text, i)
        if link:
            inner = _parse_inline(link['inner_text'], 0)
            elements.extend(_apply_style(inner, 'link', link['url']))
            i = link['end_pos']
            continue

        code = _try_parse_code(text, i)
        if code:
            elements.append({
                'text_run': {
                    'content': code['text'],
                    'text_element_style': {'inline_code': True},
                },
            })
            i = code['end_pos']
            continue

        bold = _try_parse_bold(text, i)
        if bold:
            inner = _parse_inline(bold['inner_text'], 0)
            elements.extend(_apply_style(inner, 'bold'))
            i = bold['end_pos']
            continue

        italic = _try_parse_italic(text, i)
        if italic:
            inner = _parse_inline(italic['inner_text'], 0)
            elements.extend(_apply_style(inner, 'italic'))
            i = italic['end_pos']
            continue

        strike = _try_parse_strikethrough(text, i)
        if strike:
            inner = _parse_inline(strike['inner_text'], 0)
            elements.extend(_apply_style(inner, 'strikethrough'))
            i = strike['end_pos']
            continue

        eq = _try_parse_equation(text, i)
        if eq:
            elements.append({'equation': {'content': eq['content']}})
            i = eq['end_pos']
            continue

        plain_start = i
        while i < len(text) and not _is_inline_marker_start(text, i):
            i += 1
        if i > plain_start:
            elements.append({'text_run': {'content': text[plain_start:i]}})
        else:
            elements.append({'text_run': {'content': text[i]}})
            i += 1

    return _merge_plain_text(elements)


def _is_inline_marker_start(text, i):
    ch = text[i]
    return (
        ch == '[' or
        ch == '`' or
        ch == '$' or
        (ch == '*' and i + 1 < len(text) and text[i + 1] == '*') or
        (ch == '*' and (i + 1 >= len(text) or text[i + 1] != '*')) or
        (ch == '~' and i + 1 < len(text) and text[i + 1] == '~')
    )


def _try_parse_link(text, i):
    if text[i] != '[':
        return None
    depth = 1
    j = i + 1
    while j < len(text) and depth > 0:
        if text[j] == '\\':
            j += 2
            continue
        if text[j] == '[':
            depth += 1
        elif text[j] == ']':
            depth -= 1
        j += 1
    if depth != 0:
        return None
    close_bracket = j - 1
    if j >= len(text) or text[j] != '(':
        return None
    depth = 1
    j += 1
    while j < len(text) and depth > 0:
        if text[j] == '\\':
            j += 2
            continue
        if text[j] == '(':
            depth += 1
        elif text[j] == ')':
            depth -= 1
        j += 1
    if depth != 0:
        return None
    close_paren = j - 1
    return {
        'inner_text': text[i + 1:close_bracket],
        'url': text[close_bracket + 2:close_paren],
        'end_pos': j,
    }


def _try_parse_code(text, i):
    if text[i] != '`':
        return None
    end = text.find('`', i + 1)
    if end == -1 or end == i + 1:
        return None
    return {'text': text[i + 1:end], 'end_pos': end + 1}


def _try_parse_bold(text, i):
    if text[i:i + 2] != '**':
        return None
    end = text.find('**', i + 2)
    if end == -1 or end == i + 2:
        return None
    return {'inner_text': text[i + 2:end], 'end_pos': end + 2}


def _try_parse_italic(text, i):
    if text[i] != '*' or text[i:i + 2] == '**':
        return None
    end = text.find('*', i + 1)
    if end == -1 or end == i + 1 or text[end:end + 2] == '**':
        return None
    return {'inner_text': text[i + 1:end], 'end_pos': end + 1}


def _try_parse_strikethrough(text, i):
    if text[i:i + 2] != '~~':
        return None
    end = text.find('~~', i + 2)
    if end == -1 or end == i + 2:
        return None
    return {'inner_text': text[i + 2:end], 'end_pos': end + 2}


def _try_parse_equation(text, i):
    if text[i] != '$':
        return None
    if text[i:i + 2] == '$$':
        end = text.find('$$', i + 2)
        if end != -1 and end > i + 2:
            return {'content': text[i + 2:end], 'end_pos': end + 2}
        return None
    end = text.find('$', i + 1)
    if end == -1 or end == i + 1:
        return None
    return {'content': text[i + 1:end], 'end_pos': end + 1}


def _apply_style(elements, style_type, url=None):
    result = []
    for el in elements:
        if 'equation' in el:
            result.append(el)
            continue
        style = dict(el.get('text_run', {}).get('text_element_style', {}) or {})
        if style_type == 'bold':
            style['bold'] = True
        elif style_type == 'italic':
            style['italic'] = True
        elif style_type == 'strikethrough':
            style['strikethrough'] = True
        elif style_type == 'link' and url:
            style['link'] = {'url': url}
        result.append({'text_run': {'content': el['text_run']['content'], 'text_element_style': style}})
    return result


def _merge_plain_text(elements):
    result = []
    current = ''
    for el in elements:
        tr = el.get('text_run')
        if tr and (not tr.get('text_element_style') or len(tr['text_element_style']) == 0):
            current += tr['content']
        else:
            if current:
                result.append({'text_run': {'content': current}})
                current = ''
            result.append(el)
    if current:
        result.append({'text_run': {'content': current}})
    return result


def _merge_block_text_elements(block):
    block_type = next((k for k in block if k != 'block_type'), None)
    if not block_type:
        return block
    data = block[block_type]
    if not data or not isinstance(data.get('elements'), list):
        return block
    return {
        **block,
        block_type: {
            **data,
            'elements': _merge_plain_text(data['elements']),
        },
    }


_CODE_LANGUAGE_MAP = {
    'plaintext': 1, 'abap': 2, 'ada': 3, 'apache': 4, 'apex': 5,
    'assembly': 6, 'bash': 7, 'sh': 7, 'shell': 60, 'zsh': 7,
    'csharp': 8, 'cs': 8, 'c#': 8, 'cpp': 9, 'c++': 9, 'c': 10,
    'cobol': 11, 'css': 12, 'coffeescript': 13, 'coffee': 13,
    'd': 14, 'dart': 15, 'delphi': 16, 'django': 17, 'dockerfile': 18,
    'docker': 18, 'erlang': 19, 'fortran': 20, 'foxpro': 21,
    'go': 22, 'golang': 22, 'groovy': 23, 'html': 24, 'htmlbars': 25,
    'http': 26, 'haskell': 27, 'json': 28, 'java': 29,
    'javascript': 30, 'js': 30, 'jsx': 30, 'julia': 31, 'kotlin': 32,
    'latex': 33, 'lisp': 34, 'logo': 35, 'lua': 36, 'matlab': 37,
    'makefile': 38, 'markdown': 39, 'md': 39, 'nginx': 40,
    'objective': 41, 'objectivec': 41, 'openedgeabl': 42, 'php': 43,
    'perl': 44, 'postscript': 45, 'power': 46, 'powershell': 46,
    'prolog': 47, 'protobuf': 48, 'python': 49, 'py': 49, 'r': 50,
    'rpg': 51, 'ruby': 52, 'rb': 52, 'rust': 53, 'sas': 54, 'scss': 55,
    'sql': 56, 'scala': 57, 'scheme': 58, 'scratch': 59, 'swift': 61,
    'thrift': 62, 'typescript': 63, 'ts': 63, 'tsx': 63, 'vbscript': 64,
    'visual': 65, 'xml': 66, 'yaml': 67, 'yml': 67, 'cmake': 68,
    'diff': 69, 'gherkin': 70, 'graphql': 71, 'glsl': 72,
    'properties': 73, 'solidity': 74, 'toml': 75,
}


def _map_code_language(lang):
    return _CODE_LANGUAGE_MAP.get(lang.lower(), 1)


# ============================================================
# 兼容层 helper
# ============================================================

def make_text_block(content: str) -> Dict[str, Any]:
    """创建一个纯文本块"""
    return {
        'block_type': 2,
        'text': {
            'elements': [{'text_run': {'content': content}}],
        },
    }


def make_heading_block(content: str, level: int = 1) -> Dict[str, Any]:
    """创建一个标题块 (level: 1-9)"""
    block_type = 2 + level
    field_name = f'heading{level}'
    return {
        'block_type': block_type,
        field_name: {
            'elements': [{'text_run': {'content': content}}],
        },
    }


def make_code_block(content: str) -> Dict[str, Any]:
    """创建一个代码块"""
    return {
        'block_type': 14,
        'code': {
            'elements': [{'text_run': {'content': content}}],
        },
    }




def extract_text_from_block(block: Dict) -> str:
    """从块中提取纯文本"""
    elements = (
        block.get("text", {}).get("elements", [])
        or block.get("heading1", {}).get("elements", [])
        or block.get("heading2", {}).get("elements", [])
        or block.get("heading3", {}).get("elements", [])
        or block.get("bullet", {}).get("elements", [])
        or block.get("ordered", {}).get("elements", [])
        or block.get("code", {}).get("elements", [])
        or block.get("quote", {}).get("elements", [])
        or []
    )
    return "".join(
        el.get("text_run", {}).get("content", "")
        or el.get("mention_doc", {}).get("url", "")
        for el in elements
    )


# ============ 块类型对照表 ============

BLOCK_TYPE_NAMES = {
    1: "page",
    2: "text",
    3: "heading1",
    4: "heading2",
    5: "heading3",
    6: "heading4",
    7: "heading5",
    8: "heading6",
    9: "heading7",
    10: "heading8",
    11: "heading9",
    12: "bullet",
    13: "ordered",
    14: "code",
    15: "quote",
    17: "todo",
    22: "divider",
    27: "image",
    31: "table",
    32: "table_cell",
}


def block_type_name(block_type: int) -> str:
    return BLOCK_TYPE_NAMES.get(block_type, f"type_{block_type}")


if __name__ == "__main__":
    # 快速测试
    try:
        from dotenv import load_dotenv
        env_path = Path(__file__).parent.parent.parent / ".env"
        if env_path.exists():
            load_dotenv(env_path)
            print(f"[OK] Loaded .env: {env_path}")
    except ImportError:
        pass

    client = FeishuClient()
    print(json.dumps(client.health_check(), indent=2, ensure_ascii=False))
