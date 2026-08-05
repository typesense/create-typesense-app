# Records docs/demo.gif.  Run from the repo root:
#
#   docs/record-demo.sh
#
# Committed so the demo can be re-recorded after a UI change instead of being a
# careful manual take. record-demo.sh does the setup (tear down leftovers, warm
# the Docker image, build) and then calls vhs on this file.

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
# shim from record-demo.sh once the package is on npm and the real command works.
Hide
Type "cd $CTA_DEMO_DIR && clear" Enter
Show

Type "npx create-typesense-app@latest my-search-app --yes"
Sleep 800ms
Enter

# A warm run measures around 11s. This leaves headroom without recording a long
# frozen final frame, which is most of what makes these GIFs large.
Sleep 18s
Sleep 2s
