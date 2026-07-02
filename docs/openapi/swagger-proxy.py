#!/usr/bin/env python3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
UPSTREAM = "http://127.0.0.1:8080"


class SwaggerProxyHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/proxy/"):
            self._proxy_request("GET")
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/proxy/"):
            self._proxy_request("POST")
            return
        self.send_error(405, "Method not allowed")

    def do_PUT(self):
        if self.path.startswith("/proxy/"):
            self._proxy_request("PUT")
            return
        self.send_error(405, "Method not allowed")

    def do_PATCH(self):
        if self.path.startswith("/proxy/"):
            self._proxy_request("PATCH")
            return
        self.send_error(405, "Method not allowed")

    def do_DELETE(self):
        if self.path.startswith("/proxy/"):
            self._proxy_request("DELETE")
            return
        self.send_error(405, "Method not allowed")

    def _proxy_request(self, method: str):
        upstream_path = self.path.removeprefix("/proxy")
        target_url = UPSTREAM + upstream_path

        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length) if content_length > 0 else None

        forwarded_headers = {}
        for key in ("Authorization", "Content-Type", "Accept"):
            value = self.headers.get(key)
            if value:
                forwarded_headers[key] = value

        request = Request(target_url, data=body, headers=forwarded_headers, method=method)

        try:
            with urlopen(request) as response:
                payload = response.read()
                self.send_response(response.status)
                for key, value in response.headers.items():
                    lowered = key.lower()
                    if lowered in {"content-length", "transfer-encoding", "connection", "server", "date"}:
                        continue
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except HTTPError as error:
            payload = error.read()
            self.send_response(error.code)
            for key, value in error.headers.items():
                lowered = key.lower()
                if lowered in {"content-length", "transfer-encoding", "connection", "server", "date"}:
                    continue
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except URLError as error:
            message = f"Upstream gateway unavailable: {error.reason}\n".encode()
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8099), SwaggerProxyHandler)
    print("Swagger proxy running at http://127.0.0.1:8099/swagger-ui.html")
    print("Proxying API requests to http://127.0.0.1:8080")
    server.serve_forever()
