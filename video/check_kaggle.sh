#!/usr/bin/env bash
# Verify Kaggle CLI auth from the VM. Only the KAGGLE_* vars are exported
# (sourcing the whole .env breaks on unquoted values with spaces).
export PATH="$PATH:$HOME/.local/bin"
export KAGGLE_USERNAME="$(grep -E '^KAGGLE_USERNAME=' "$HOME/agent/.env" | head -1 | cut -d= -f2- | tr -d '\r"')"
export KAGGLE_KEY="$(grep -E '^(KAGGLE_KEY|KAGGLE_API_TOKEN|VIDEO_TOKEN)=' "$HOME/agent/.env" | head -1 | cut -d= -f2- | tr -d '\r"')"
export KAGGLE_API_TOKEN="$KAGGLE_KEY"
kaggle --version
echo "Authenticated User: $KAGGLE_USERNAME"
kaggle datasets list --mine 2>&1 | head -8

