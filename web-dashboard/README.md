# PROTO36 Dashboard

This dashboard combines:

- MediaMTX camera video at `http://<pi-host>:8889/cam`
- WebSocket controls at `ws://<pi-host>:8765`
- W/A/S/D keyboard controls
- Touch-friendly drive buttons
- Throttle and steering sliders
- A large STOP button
- Automatic zeroing when the browser loses focus

## Put it on the Raspberry Pi

```bash
mkdir -p ~/web-dashboard
cd ~/web-dashboard
```

Copy `index.html`, `style.css`, and `app.js` into that folder.

Start the site:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Open from another device on the same network:

```text
http://<PI_IP_ADDRESS>:8000
```

Because the JavaScript uses `window.location.hostname`, it automatically connects to
the same Raspberry Pi hostname or IP used to open the dashboard.

## Required services

MediaMTX should be running on port 8889, and `control_server.py` should be running on port 8765.
