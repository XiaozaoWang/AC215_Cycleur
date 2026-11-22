"""Encode the home screen's landscape video (public/home-landscape.mp4) and its poster (public/home-landscape.jpg).

render.html draws the landscape with WebGL as a seamless 81 s loop and posts the frames here as raw grey bytes; this
server pipes them into ffmpeg, which blurs them softly (the blur the page used to apply live) and encodes H.264.
Playing a video costs the browser almost nothing, unlike drawing the landscape live.

Run from src/frontend:

    docker run --rm -it -p 127.0.0.1:3205:8000 -v "$PWD/tools/landscape-video":/w -v "$PWD/public":/out \
        alpine:3.20 sh -c "apk add --no-cache ffmpeg python3 && python3 /w/server.py"

then open http://localhost:3205/ in a browser and run record() in its console (or open /?preview to watch the loop,
or run stills() to write key frames of each lighting look to a stills/ folder next to the video, for comparing;
delete that folder afterwards, it is not part of the site).
"""
import http.server
import subprocess

W, H, FPS = 1280, 720, 30
OUT = "/out/home-landscape.mp4"
POSTER = "/out/home-landscape.jpg"
FFMPEG = [
    "ffmpeg", "-y", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
    # soft focus over the whole frame, then video range (16-235) the way browsers expect it
    "-vf", "gblur=sigma=3.2,scale=in_range=full:out_range=limited,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-profile:v", "high", "-x264-params", "aq-mode=3",
    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-movflags", "+faststart", "-an", OUT,
]


class Handler(http.server.SimpleHTTPRequestHandler):
    encoder = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="/w", **kwargs)

    def do_GET(self):
        if self.path.split("?")[0] == "/":
            self.path = "/render.html" + (self.path[1:] if "?" in self.path else "")
        super().do_GET()

    def reply(self, text, code=200):
        body = text.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        cls = type(self)
        if self.path == "/frames":
            if len(body) % (W * H):
                return self.reply("frames must be whole", 400)
            if cls.encoder is None:
                cls.encoder = subprocess.Popen(FFMPEG, stdin=subprocess.PIPE)
            cls.encoder.stdin.write(body)
            return self.reply("ok")
        if self.path.startswith("/stills"):   # key frames as PNGs, through the same blur as the video
            name = self.path.split("name=")[-1] if "name=" in self.path else "key"
            subprocess.run(["mkdir", "-p", "/out/stills"])
            code = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}",
                                   "-i", "-", "-vf", "gblur=sigma=3.2", f"/out/stills/{name}-%02d.png"], input=body).returncode
            return self.reply(f"stills exit {code}", 200 if code == 0 else 500)
        if self.path == "/done" and cls.encoder is not None:
            cls.encoder.stdin.close()
            code = cls.encoder.wait()
            cls.encoder = None
            if code == 0:   # the poster: the loop's first frame, shown until the video plays
                code = subprocess.call(["ffmpeg", "-y", "-loglevel", "error", "-i", OUT, "-frames:v", "1", "-q:v", "3", POSTER])
            print("finished, ffmpeg exit", code, flush=True)
            return self.reply(f"ffmpeg exit {code}")
        return self.reply("unknown", 404)

    def log_message(self, *args):
        pass


print(f"open http://localhost:3205/ and run record()", flush=True)
http.server.HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
