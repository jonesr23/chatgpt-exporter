from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import uuid
import cgi

UPLOAD_ROOT = "uploads"

if not os.path.exists(UPLOAD_ROOT):
    os.makedirs(UPLOAD_ROOT)


class MockBridge(BaseHTTPRequestHandler):

    def _set_json(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):

        if self.path == "/session/start":
            self._set_json()
            session_id = str(uuid.uuid4())
            session_path = os.path.join(UPLOAD_ROOT, session_id)
            os.makedirs(session_path, exist_ok=True)

            response = {
                "sessionId": session_id,
                "uploadToken": "test-token"
            }

            self.wfile.write(json.dumps(response).encode())
            return

        if self.path == "/upload":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            data = json.loads(body.decode("utf-8"))
            session_id = data.get("sessionId")

            session_path = os.path.join(UPLOAD_ROOT, session_id)
            os.makedirs(session_path, exist_ok=True)

            file_path = os.path.join(session_path, "conversation.json")

            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

            print(f"Saved conversation JSON to {file_path}")

            self._set_json()
            self.wfile.write(json.dumps({"status": "conversation saved"}).encode())
            return

        if self.path == "/upload/file":
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    'REQUEST_METHOD': 'POST',
                    'CONTENT_TYPE': self.headers['Content-Type'],
                }
            )

            session_id = form.getvalue("sessionId")
            file_item = form["file"]

            if file_item.filename:
                session_path = os.path.join(UPLOAD_ROOT, session_id)
                os.makedirs(session_path, exist_ok=True)

                file_path = os.path.join(session_path, file_item.filename)

                with open(file_path, "wb") as f:
                    f.write(file_item.file.read())

                print(f"Saved file: {file_path}")

            self._set_json()
            self.wfile.write(json.dumps({"status": "file saved"}).encode())
            return

        self.send_response(404)
        self.end_headers()


def run(port=3000):
    server_address = ('', port)
    httpd = HTTPServer(server_address, MockBridge)
    print(f"Mock bridge running on http://localhost:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    run()