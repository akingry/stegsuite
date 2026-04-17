from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
import os
import time

root = Path(r"D:\OC\workspace\stegsuite")
os.chdir(root)

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

server = ThreadingHTTPServer(('127.0.0.1', 18400), Handler)
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()

time.sleep(1)

out_dir = root / 'docs' / 'images'
out_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    page.goto('http://127.0.0.1:18400/remote-player/index.html', wait_until='domcontentloaded')
    page.wait_for_timeout(2000)
    page.screenshot(path=str(out_dir / 'stegsuite-remote-player.png'), full_page=True)
    browser.close()

server.shutdown()
server.server_close()
