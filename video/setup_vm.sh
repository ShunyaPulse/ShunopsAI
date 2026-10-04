#!/usr/bin/env bash
# One-time VM setup for the video pipeline orchestrator (lightweight: only the Kaggle CLI).
# Heavy work (TTS, visuals, whisper, ffmpeg) runs inside a Kaggle kernel, NOT on this 1GB VM.
set -e
if ! command -v pip3 >/dev/null 2>&1; then
  sudo apt-get install -y -qq python3-pip 2>&1 | tail -2
fi
pip3 install --user --break-system-packages -q kaggle 2>&1 | tail -2 || true
export PATH="$PATH:$HOME/.local/bin"
# .env was written on Windows (CRLF) - strip carriage returns before sourcing
set -a
. <(tr -d '\r' < "$HOME/agent/.env")
set +a
kaggle --version
kaggle kernels list --mine 2>&1 | head -8

