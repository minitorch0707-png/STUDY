#!/bin/bash
# LectureLab one-step installer for macOS.
#
# Paste this into Terminal:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/minitorch0707-png/lecturelab/main/install.sh)"
#
# Most people should just download the desktop app instead (see README). This
# script is for running LectureLab from source in the browser.
#
# It installs everything into ~/LectureLab (no admin password needed for that part):
#   - a private copy of Node.js (doesn't touch anything else on your Mac)
#   - the LectureLab app
#   - the Ollama AI app (into Applications) and the AI models
# Then it puts a "LectureLab" launcher on your Desktop and opens the app.
# Running it again later updates LectureLab and keeps all your courses and progress.

set -e

REPO="minitorch0707-png/lecturelab"
NODE_VERSION="v22.23.5"
HOME_DIR="${LECTURELAB_HOME:-$HOME/LectureLab}"
APP="$HOME_DIR/app"
DATA="$HOME_DIR/data"
RUNTIME="$HOME_DIR/runtime"
PORT=3000
CHAT_MODEL="qwen3:4b"
EMBED_MODEL="nomic-embed-text"

bold() { printf "\n\033[1m%s\033[0m\n" "$1"; }
ok() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
info() { printf "  %s\n" "$1"; }
fail() {
  printf "\n\033[31m✗ %s\033[0m\n" "$1"
  printf "  If you're stuck, copy everything in this window and send it to whoever is helping you.\n\n"
  exit 1
}

OS="$(uname -s)"
ARCH="$(uname -m)"
if [ "$OS" != "Darwin" ] && [ -z "$LECTURELAB_ALLOW_LINUX" ]; then fail "This installer is for macOS."; fi

bold "Installing LectureLab into $HOME_DIR"
mkdir -p "$HOME_DIR" "$DATA" "$RUNTIME"

# ---------------------------------------------------------------- 1. Node.js
bold "Step 1 of 5 · Node.js (runs the app)"
case "$OS-$ARCH" in
  Darwin-arm64) NODE_PLATFORM="darwin-arm64" ;;
  Darwin-x86_64) NODE_PLATFORM="darwin-x64" ;;
  Linux-x86_64) NODE_PLATFORM="linux-x64" ;;
  Linux-aarch64) NODE_PLATFORM="linux-arm64" ;;
  *) fail "Unsupported computer type: $OS $ARCH" ;;
esac
NODE_DIR="$RUNTIME/node-$NODE_VERSION-$NODE_PLATFORM"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  info "Downloading Node.js $NODE_VERSION (about 50 MB)…"
  curl -fL --progress-bar "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$NODE_PLATFORM.tar.gz" -o "$RUNTIME/node.tar.gz" || fail "Couldn't download Node.js. Check your internet connection."
  tar -xzf "$RUNTIME/node.tar.gz" -C "$RUNTIME" && rm -f "$RUNTIME/node.tar.gz"
fi
export PATH="$NODE_DIR/bin:$PATH"
ok "Node.js $(node -v) ready"

# ---------------------------------------------------------------- 2. App code
bold "Step 2 of 5 · LectureLab app"
TMP="$(mktemp -d)"
info "Downloading the latest version…"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" -o "$TMP/app.tar.gz" || fail "Couldn't download LectureLab from GitHub."
mkdir -p "$TMP/app" && tar -xzf "$TMP/app.tar.gz" -C "$TMP/app" --strip-components=1
# Keep installed packages between updates (faster); your data lives outside the app folder.
if [ -d "$APP/node_modules" ]; then mv "$APP/node_modules" "$TMP/app/node_modules"; fi
rm -rf "$APP" && mv "$TMP/app" "$APP" && rm -rf "$TMP"
cd "$APP"
info "Installing components (1–3 minutes)…"
npm ci --no-audit --no-fund --loglevel=error >"$HOME_DIR/install.log" 2>&1 || { tail -20 "$HOME_DIR/install.log"; fail "Installing components failed (details above)."; }
info "Building the app (about a minute)…"
npm run build >>"$HOME_DIR/install.log" 2>&1 || { tail -20 "$HOME_DIR/install.log"; fail "Building the app failed (details above)."; }
ok "LectureLab installed"

# ---------------------------------------------------------------- 3. Ollama
bold "Step 3 of 5 · Ollama (the local AI engine)"
ollama_up() { curl -fs "http://127.0.0.1:11434/api/version" >/dev/null 2>&1; }
wait_for_ollama() {
  for _ in $(seq 1 60); do ollama_up && return 0; sleep 2; done
  return 1
}
if ollama_up; then
  ok "Ollama is already running"
elif [ "$OS" = "Darwin" ]; then
  if [ ! -d "/Applications/Ollama.app" ] && [ ! -d "$HOME/Applications/Ollama.app" ]; then
    info "Downloading Ollama…"
    DEST="/Applications"
    [ -w "$DEST" ] || { mkdir -p "$HOME/Applications"; DEST="$HOME/Applications"; }
    OTMP="$(mktemp -d)"
    if curl -fL --progress-bar "https://ollama.com/download/Ollama.dmg" -o "$OTMP/Ollama.dmg" 2>/dev/null; then
      MNT="$(hdiutil attach -nobrowse -quiet "$OTMP/Ollama.dmg" | tail -1 | awk -F'\t' '{print $NF}')"
      [ -n "$MNT" ] && cp -R "$MNT/Ollama.app" "$DEST/" && hdiutil detach -quiet "$MNT" || true
    fi
    if [ ! -d "$DEST/Ollama.app" ] && curl -fL --progress-bar "https://ollama.com/download/Ollama-darwin.zip" -o "$OTMP/Ollama.zip" 2>/dev/null; then
      unzip -q "$OTMP/Ollama.zip" -d "$DEST" || true
    fi
    rm -rf "$OTMP"
  fi
  if [ -d "/Applications/Ollama.app" ]; then open -a "/Applications/Ollama.app"; elif [ -d "$HOME/Applications/Ollama.app" ]; then open -a "$HOME/Applications/Ollama.app"; fi
  info "Starting Ollama… (if a window asks to finish setup or move to Applications, click through it)"
  if ! wait_for_ollama; then
    info "I couldn't install Ollama automatically. Opening the download page:"
    info "  1. Download and open Ollama, drag it to Applications, and start it."
    info "  2. Come back to this window and press Enter."
    open "https://ollama.com/download" || true
    read -r _ </dev/tty || true
    wait_for_ollama || fail "Ollama still isn't running. Open the Ollama app, then run this installer again."
  fi
  ok "Ollama is running"
else
  info "(Skipping Ollama install on this system.)"
fi

# ---------------------------------------------------------------- 4. Models
bold "Step 4 of 5 · AI models (about 2.8 GB — the slowest step, usually 5–15 minutes)"
pull() {
  node -e '
    const model = process.argv[1];
    (async () => {
      const res = await fetch("http://127.0.0.1:11434/api/pull", { method: "POST", body: JSON.stringify({ model, stream: true }) });
      if (!res.ok) throw new Error(await res.text());
      const dec = new TextDecoder(); let buf = ""; let last = "";
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.error) throw new Error(ev.error);
          const pct = ev.total ? ` ${Math.floor((ev.completed || 0) / ev.total * 100)}%` : "";
          const msg = `  ${model}: ${ev.status}${pct}`;
          if (msg !== last) { process.stdout.write("\r\x1b[K" + msg); last = msg; }
        }
      }
      process.stdout.write("\n");
    })().catch((e) => { console.error("\n  " + e.message); process.exit(1); });
  ' "$1"
}
if ollama_up; then
  pull "$EMBED_MODEL" || fail "Couldn't download $EMBED_MODEL."
  pull "$CHAT_MODEL" || fail "Couldn't download $CHAT_MODEL."
  ok "AI models ready"
else
  info "Ollama isn't running, so models will be installed later from Settings → AI Models."
fi

# ---------------------------------------------------------------- 5. Launcher
bold "Step 5 of 5 · Desktop launcher"
LAUNCHER="$HOME_DIR/Start LectureLab.command"
cat >"$LAUNCHER" <<LAUNCH
#!/bin/bash
# Double-click to start LectureLab. Keep this window open while you study; close it to stop.
export PATH="$NODE_DIR/bin:\$PATH"
export LECTURELAB_DATA_DIR="$DATA"
cd "$APP" || exit 1
if curl -fs "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then
  open "http://127.0.0.1:$PORT"; exit 0
fi
if ! curl -fs http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  open -a Ollama 2>/dev/null || true
fi
echo ""
echo "  LectureLab is starting… your browser will open in a moment."
echo "  Keep this window open while you use LectureLab. Close it to stop."
echo ""
( for i in \$(seq 1 60); do curl -fs "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1 && { open "http://127.0.0.1:$PORT"; break; }; sleep 1; done ) &
exec npx next start -H 127.0.0.1 -p $PORT
LAUNCH
chmod +x "$LAUNCHER"
if [ -d "$HOME/Desktop" ]; then
  cp "$LAUNCHER" "$HOME/Desktop/LectureLab.command" && chmod +x "$HOME/Desktop/LectureLab.command"
  ok "Added “LectureLab” to your Desktop — double-click it any time to start"
fi

bold "All done! 🎉"
info "Your courses and progress are saved in $DATA"
info "Starting LectureLab now…"
if [ "$OS" = "Darwin" ]; then exec "$LAUNCHER"; fi
