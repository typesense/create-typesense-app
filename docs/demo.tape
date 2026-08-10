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
# src/prompts.ts: name, framework, server, sample data. If that order changes,
# this tape needs changing with it.

Output docs/demo.gif

Require docker

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 1000
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

# Project name: accept the default.
Sleep 2s
Enter

# Framework: pause long enough to read the list, move through it to show the
# choice is real, then come back to the recommended one.
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
Sleep 1.5s
Enter

# Sample data: the books dataset is preselected.
Sleep 1.3s
Enter

# Scaffold, install, start the server, download the dataset, index, verify.
# The prompts above take about 9s, and the run itself about 25s with a warm image
# but a cold dataset cache. Too short a wait here truncates the GIF just before
# the payoff, which is exactly what happened the first time.
Sleep 32s
Sleep 2s
