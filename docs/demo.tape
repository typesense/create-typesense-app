# Records docs/demo.gif.  Run from the repo root:
#
#   docs/record-demo.sh
#
# Committed so the demo can be re-recorded after a UI change instead of being a
# careful manual take. record-demo.sh does the setup (tear down leftovers, warm
# the Docker image, build) and then calls vhs on this file.
#
# This drives the interactive flow rather than --yes, because the framework picker
# is the thing worth showing. The keypresses below assume the prompt order in
# src/prompts.ts for a local server: name, framework, server. If that order
# changes, this tape needs changing with it.

Output docs/demo.gif

Require docker

Set Shell "bash"
Set FontSize 16
Set Width 1200
# Tall enough that the whole run fits without scrolling: once the window
# scrolls, vhs can no longer read the screen, and the Wait below never matches.
Set Height 1450
Set Padding 20
Set TypingSpeed 55ms
Set WindowBar Colorful
Set BorderRadius 8

# Setup, not recorded. CTA_DEMO_DIR and PATH are exported by record-demo.sh:
# PATH holds a shim so the command shown below runs this repo's build. Delete the
# shim from record-demo.sh once the current templates are published.
Hide
Type "cd $CTA_DEMO_DIR && clear" Enter
Show

Type "npx create-typesense-app@latest"
Sleep 800ms
Enter

# Each answer waits for its question: a key sent before the prompt listens is
# lost, and the take then hangs at that prompt.

# Project name: accept the default.
Wait+Screen@60s /Project name/
Sleep 1.2s
Enter

# Framework: pause long enough to read the list, move through it to show the
# choice is real, then come back to the recommended one.
Wait+Screen@30s /Framework\?/
Sleep 2.2s
Down
Sleep 600ms
Down
Sleep 800ms
Up
Sleep 400ms
Up
Sleep 900ms
Enter

# Typesense server: local Docker is preselected.
Wait+Screen@30s /Typesense server\?/
Sleep 1.5s
Enter

# Scaffold, install, start the server, download the dataset, index, verify.
# record-demo.sh warms the npm cache and the Docker image first, so this takes
# about 15s. Wait for the last line rather than sleeping a guessed time: a fixed
# sleep that is too short cuts the GIF just before the payoff.
Wait+Screen@180s /Done in my-search-app/

# The CLI then starts the dev server and opens the browser. record-demo.sh puts
# a stand-in for `open` on PATH, so no browser opens on the recording machine.
Wait+Screen@60s /Ready in/
Sleep 3s
Ctrl+C
Wait+Screen@30s /dev server stopped/
Sleep 3s
