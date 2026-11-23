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

# Another Typesense on 8108 makes the CLI ask whether to reuse it, which is not
# the flow the GIF shows. Stop rather than guess whose server it is.
if (exec 3<>/dev/tcp/127.0.0.1/8108) 2>/dev/null; then
  echo "Port 8108 is in use. Stop whatever holds it, then run this again:"
  echo "  lsof -nP -iTCP:8108 -sTCP:LISTEN"
  exit 1
fi

echo "==> Warming the image so the GIF is not a download progress bar"
docker pull --quiet typesense/typesense:30.2 >/dev/null

echo "==> Building"
npm run build >/dev/null

# A first run spends minutes in npm installing the Next.js starter. One throwaway
# run fills the npm cache, so the recorded run takes seconds.
echo "==> Warming the npm cache with a throwaway run"
warm="$(mktemp -d)"
(cd "$warm" && node "$repo/dist/index.js" warm-up --yes >/dev/null 2>&1)
(cd "$warm/warm-up" && docker compose down --volumes >/dev/null 2>&1) || true
rm -rf "$warm"

# Commands that the recorded run finds first on PATH.
shim="$(mktemp -d)"
export PATH="$shim:$PATH"

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
# --- end BEFORE PUBLISH -----------------------------------------------------

# After the run, the CLI opens the app in the browser. These stand-ins keep a
# browser window from opening on the recording machine; the GIF shows only the
# terminal anyway.
for opener in open xdg-open; do
  printf '#!/bin/sh\nexit 0\n' > "$shim/$opener"
  chmod +x "$shim/$opener"
done

# The dev server prints a Network: line with this machine's LAN address. Hide
# the machine's network interfaces from every Node process in the recording, so
# that the address does not end up in a public GIF. Next.js then prints only
# the Local: line.
cat > "$shim/hide-network.cjs" <<'PRELOAD'
const os = require('node:os')
const all = os.networkInterfaces
os.networkInterfaces = () =>
  Object.fromEntries(
    Object.entries(all()).map(([name, addresses]) => [name, addresses.filter((a) => a.internal)]),
  )
PRELOAD
export NODE_OPTIONS="--require $shim/hide-network.cjs"

# A short, fixed path: mktemp -d on macOS produces
# /private/var/folders/kb/qh_tw84.../T/tmp.XXXX, which is noise in the recording.
CTA_DEMO_DIR="/tmp/cta-demo"
export CTA_DEMO_DIR

# Removes only what this script started: the demo project's own containers,
# volume and directory. Runs before the take, and on every exit, so a failed
# take does not leave a server on 8108.
remove_demo() {
  if [ -d "$CTA_DEMO_DIR/my-search-app" ]; then
    (cd "$CTA_DEMO_DIR/my-search-app" && docker compose down --volumes >/dev/null 2>&1) || true
  fi
  rm -rf "$CTA_DEMO_DIR"
}
trap 'remove_demo; rm -rf "$shim"' EXIT

remove_demo
mkdir -p "$CTA_DEMO_DIR"
echo "==> Recording in $CTA_DEMO_DIR"

vhs docs/demo.tape

echo "==> Done: $(du -h docs/demo.gif | cut -f1) at docs/demo.gif"
