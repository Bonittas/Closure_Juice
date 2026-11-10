#!/usr/bin/env python3
"""Serve this folder fast on http://127.0.0.1:8765/ and open it in the default browser.

  python serve.py [--port 8765] [--no-open]

Why not "python -m http.server" + http://localhost:8765/? On Windows "localhost" may be tried as IPv6 (::1) first
while http.server listens on IPv4 only, and HTTPServer.server_bind() does a getfqdn() lookup; both can add seconds.
This server binds 127.0.0.1 only, never resolves names, sets correct MIME types for ES modules, fonts and sims.bin.
"""
import argparse, os, socketserver, threading, webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html",
                      ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2",
                      ".bin": "application/octet-stream", ".json": "application/json", ".txt": "text/plain"}

    def address_string(self):
        return self.client_address[0]

    def log_message(self, fmt, *args):
        pass


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):  # skip HTTPServer's getfqdn()
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = "127.0.0.1", self.server_address[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-open", action="store_true")
    a = ap.parse_args()
    srv = Server(("127.0.0.1", a.port), partial(Handler, directory=HERE))
    url = "http://127.0.0.1:%d/" % a.port
    print("Maleda: serving %s on %s  (Ctrl+C to stop)" % (HERE, url), flush=True)
    if not a.no_open:
        threading.Timer(0.3, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
