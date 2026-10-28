#!/usr/bin/env bash
# Installs the APK on an emulator and taps through on-phone mode, the way a new user would.
# Prints what's on screen at each step and fails on a crash or a missing screen.
set -uo pipefail
APK="$1"
OUT="${2:-smoke}"
PKG=com.stockpilot.app
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
step=0
fail() { echo "SMOKE FAIL: $*"; adb logcat -d -s ReactNativeJS:V AndroidRuntime:E > "$OUT/logcat.txt"; tail -80 "$OUT/logcat.txt"; exit 1; }
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1; }
shot() { step=$((step + 1)); adb exec-out screencap -p > "$OUT/$(printf %02d $step)-$1.png"; }
alive() { adb shell pidof "$PKG" >/dev/null || fail "app is not running (crashed?)"; }
expect() { # wait up to $2 seconds for text $1 to be on screen
  for _ in $(seq 1 "${2:-30}"); do dump; python3 "$HERE/ui.py" center "$OUT/ui.xml" "$1" >/dev/null && return 0; sleep 1; done
  echo "--- screen ---"; python3 "$HERE/ui.py" texts "$OUT/ui.xml" | head -60; fail "did not see \"$1\""
}
read -r W H < <(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1 | tr x ' ')
swipe_up() { adb shell input swipe $((W / 2)) $((H * 7 / 10)) $((W / 2)) $((H * 3 / 10)) 300; sleep 1; }
tap() { # tap the element labelled $1, scrolling down to find it if needed
  for _ in 1 2 3 4 5 6 7; do
    dump
    if read -r x y < <(python3 "$HERE/ui.py" center "$OUT/ui.xml" "$1"); then adb shell input tap "$x" "$y"; sleep "${2:-2}"; return 0; fi
    swipe_up
  done
  echo "--- screen ---"; python3 "$HERE/ui.py" texts "$OUT/ui.xml" | head -60; fail "nothing to tap called \"$1\""
}
seek() { # like expect, but scrolls down to find it
  for _ in 1 2 3 4 5 6 7 8; do dump; python3 "$HERE/ui.py" center "$OUT/ui.xml" "$1" >/dev/null && return 0; swipe_up; done
  echo "--- screen ---"; python3 "$HERE/ui.py" texts "$OUT/ui.xml" | head -60; fail "did not find \"$1\""
}
screen() { dump; echo "=== $1 ==="; python3 "$HERE/ui.py" texts "$OUT/ui.xml" | head -40; }

adb install -r "$APK" || fail "install failed"
adb logcat -c
adb shell am start -n "$PKG/.MainActivity" || fail "could not start"
expect "Start on this phone" 90; alive; shot sign-in; screen "Sign-in"
tap "Start on this phone" 4
expect "Just look around with a demo store" 30; shot empty-store
tap "Just look around with a demo store" 6
expect "Profit after fees" 90; alive; shot home; screen "Home with demo store"
tap "Forecast" 6; expect "Next week" 60; alive; shot forecast; screen "Forecast"
tap "Trends" 4; expect "Trending now" 30; shot trends; screen "Trends"
tap "Add to my store" 3
tap "Tools" 3; expect "Supplier orders" 30; shot tools
tap "See what to order" 6; expect "Total at cost price" 60; alive; shot orders; screen "Supplier orders"
adb shell input keyevent KEYCODE_BACK; sleep 2
tap "Open this week" 6; expect "Do this week" 60; shot weekly-plan; screen "Weekly plan"
tap "Check with AI" 4; seek "AI features run on StockPilot"; shot ai-needs-server
adb shell input keyevent KEYCODE_BACK; sleep 2
tap "Home" 3; tap "Account" 3; expect "Import sales or stock" 20
tap "Import sales or stock" 3; expect "Where do you sell?" 20
tap "Amazon" 3; tap "No file yet? Try a sample" 10; expect "Looks right: import" 60; shot import-preview; screen "Import preview"
tap "Looks right: import" 8; expect "Done" 60; alive; shot import-done; screen "Import done"
# Pick a real file through Android's file picker (best effort: the picker's layout differs by Android version).
printf 'Date,Product,Qty,Price\n2026-10-20,Phone test mug,2,9.99\n2026-10-21,Phone test mug,1,9.99\n' > "$OUT/phone-test.csv"
adb push "$OUT/phone-test.csv" /sdcard/Download/phone-test.csv >/dev/null
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/phone-test.csv >/dev/null 2>&1
tap "Upload another file" 3; tap "My own spreadsheet" 3; tap "I have my file: choose it" 5; shot picker
picked=no
for target in "phone-test.csv" "Show roots" "Downloads" "phone-test.csv"; do
  dump
  if python3 "$HERE/ui.py" center "$OUT/ui.xml" "$target" >/dev/null; then tap "$target" 3; [ "$target" = phone-test.csv ] && picked=yes && break; fi
done
if [ "$picked" = yes ]; then
  expect "Looks right: import" 30; screen "Own file preview"; tap "Looks right: import" 6; expect "Done" 30; shot own-file-done; screen "Own file imported"
else
  echo "NOTE: could not drive the system file picker on this emulator; skipped the own-file step."; screen "Picker"; adb shell input keyevent KEYCODE_BACK; sleep 2
fi
alive
# Reopen the app: on-phone data must still be there.
adb shell am force-stop "$PKG"; sleep 2; adb shell am start -n "$PKG/.MainActivity"
expect "Profit after fees" 90; shot reopened; screen "After reopening"
adb logcat -d -s ReactNativeJS:V AndroidRuntime:E > "$OUT/logcat.txt"
if grep -E "FATAL EXCEPTION|Unhandled (JS )?Exception|TypeError|ReferenceError" "$OUT/logcat.txt"; then fail "errors in the log"; fi
echo "SMOKE OK"
