#!/usr/bin/env bash
# Records docs/demo.gif with vhs.
#
#   docs/record-demo.sh
#
# Handles the setup that makes the difference between a good take and a bad one:
# no leftover container holding port 8108, the Docker image already pulled (a cold
# run spends most of its time downloading 218 MB), and a fresh build.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

command -v vhs >/dev/null || { echo "vhs is not installed: brew install vhs"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running."; exit 1; }

echo "==> Clearing anything holding port 8108"
docker ps -aq --filter ancestor=typesense/typesense:30.2 |
  while read -r id; do docker rm -f "$id" >/dev/null; done
docker volume ls -q --filter name=typesense-data |
  while read -r v; do docker volume rm "$v" >/dev/null 2>&1 || true; done

echo "==> Warming the image so the GIF is not a download progress bar"
docker pull --quiet typesense/typesense:30.2 >/dev/null

echo "==> Building"
npm run build >/dev/null

# --- BEFORE PUBLISH ---------------------------------------------------------
# The GIF shows `npx create-typesense-app@latest`, which is what people will type.
# Until the package is on npm, that cannot resolve, so this shim makes it run the
# local build instead. The recorded output is genuine output from this repo.
#
# Once published: delete this block, and the real command records as-is.
#
# The shim must intercept ONLY its own package. The CLI shells out to
# `npx --yes create-next-app@latest` to scaffold, and an unconditional shim
# swallows that too, sending create-next-app's flags back into this CLI.
real_npx="$(command -v npx)"
shim="$(mktemp -d)"
cat > "$shim/npx" <<SHIM
#!/bin/sh
case "\$1" in
  create-typesense-app*)
    shift
    exec node "$repo/dist/index.js" "\$@"
    ;;
esac
exec "$real_npx" "\$@"
SHIM
chmod +x "$shim/npx"
export PATH="$shim:$PATH"
# --- end BEFORE PUBLISH -----------------------------------------------------

# A short, fixed path: mktemp -d on macOS produces
# /private/var/folders/kb/qh_tw84.../T/tmp.XXXX, which is noise in the recording.
CTA_DEMO_DIR="/tmp/cta-demo"
rm -rf "$CTA_DEMO_DIR"
mkdir -p "$CTA_DEMO_DIR"
export CTA_DEMO_DIR
echo "==> Recording in $CTA_DEMO_DIR"

vhs docs/demo.tape

echo "==> Tearing down what the demo started"
if [ -d "$CTA_DEMO_DIR/my-search-app" ]; then
  (cd "$CTA_DEMO_DIR/my-search-app" && docker compose down --volumes >/dev/null 2>&1) || true
fi
rm -rf "$CTA_DEMO_DIR" "$shim"

echo "==> Done: $(du -h docs/demo.gif | cut -f1) at docs/demo.gif"
