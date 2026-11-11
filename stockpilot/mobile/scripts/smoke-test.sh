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
expect() { # wait up to $2 seconds for text $1 to be on screen; if it still isn't, scroll to look for it
  for _ in $(seq 1 "${2:-30}"); do dump; python3 "$HERE/ui.py" center "$OUT/ui.xml" "$1" >/dev/null && return 0; sleep 1; done
  locate_el "$1" >/dev/null && return 0
  echo "--- screen ---"; python3 "$HERE/ui.py" texts "$OUT/ui.xml" | head -60; fail "did not see \"$1\""
}
read -r W H < <(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1 | tr x ' ')
swipe_up() { adb shell input swipe $((W / 2)) $((H * 7 / 10)) $((W / 2)) $((H * 3 / 10)) 300; sleep 1; }
swipe_down() { adb shell input swipe $((W / 2)) $((H * 3 / 10)) $((W / 2)) $((H * 7 / 10)) 300; sleep 1; }
to_top() { # scroll up until $1 is on screen
  for _ in 1 2 3 4 5 6 7 8 9 10; do dump; python3 "$HERE/ui.py" center "$OUT/ui.xml" "$1" >/dev/null && return 0; swipe_down; done
}
locate_el() { # look for $1 on screen, scrolling down, then back up; prints "x y"
  for dir in down up; do
    for _ in 1 2 3 4 5 6 7 8; do
      dump
      python3 "$HERE/ui.py" center "$OUT/ui.xml" "$1" && return 0
      if [ "$dir" = down ]; then swipe_up; else swipe_down; fi
    done
  done
  return 1
}
tap() { # tap the element labelled $1, scrolling to find it if needed
  local pos
  pos=$(locate_el "$1") || { echo "--- screen ---"; python3 "$HERE/ui.py" texts "$OUT/ui.xml" | head -60; fail "nothing to tap called \"$1\""; }
  adb shell input tap $pos; sleep "${2:-2}"
}
seek() { # wait for $1 to load, then scroll to find it
  sleep "${2:-2}"
  locate_el "$1" >/dev/null || { echo "--- screen ---"; python3 "$HERE/ui.py" texts "$OUT/ui.xml" | head -60; fail "did not find \"$1\""; }
}

screen() { dump; echo "=== $1 ==="; python3 "$HERE/ui.py" texts "$OUT/ui.xml" | head -40; }
hide_keyboard() { adb shell dumpsys input_method | grep -q "mInputShown=true" && adb shell input keyevent KEYCODE_BACK; sleep 1; }
type_into() { # tap the field labelled or hinted $1 and type $2
  tap "$1" 1; adb shell input text "$(printf %s "$2" | sed 's/ /%s/g')"; sleep 1; hide_keyboard
}

adb install -r "$APK" || fail "install failed"
adb logcat -c
adb shell am start -n "$PKG/.MainActivity" || fail "could not start"
# No server in this build: the app opens straight into on-phone mode, no sign-in.
expect "Just look around with a demo store" 90; alive; shot first-open; screen "First open"
tap "Just look around with a demo store" 6
expect "This week's plan" 90; alive; seek "Profit after fees"; shot home; screen "Home with demo store"
# Smart alerts on Home, and the one-time offer of phone notifications (Android asks for permission).
seek "Needs your attention"
seek "Want a nudge when something needs you?" 2; tap "Turn on" 3
dump; if python3 "$HERE/ui.py" center "$OUT/ui.xml" "Allow" >/dev/null; then tap "Allow" 2; fi
shot notifications-on
tap "Forecast" 6; expect "Next week" 60; alive; shot forecast; screen "Forecast"
tap "Trends" 4; expect "Trending now" 30; shot trends; screen "Trends"
tap "Add to my store" 3
tap "Tools" 3; expect "Ask StockPilot" 30; seek "Supplier orders"; shot tools
tap "Find my profit leaks" 4; expect "Slipping away a month" 60; alive; shot leaks; screen "Profit leaks"
adb shell input keyevent KEYCODE_BACK; sleep 2
tap "See my alerts" 4; expect "Phone notifications" 60; seek "Turn off notifications"; alive; shot alerts; screen "Alerts"
adb shell input keyevent KEYCODE_BACK; sleep 2
tap "See what to order" 6; expect "Total at cost price" 60; alive; shot orders; screen "Supplier orders"
adb shell input keyevent KEYCODE_BACK; sleep 2
tap "Open this week" 6; expect "Weekly Plan" 60; seek "Do this week"; shot weekly-plan; screen "Weekly plan"
seek "Share this plan"
adb shell input keyevent KEYCODE_BACK; sleep 2
# Product Check without AI: the numbers from the user's own test (cost 300, price 350 on eBay).
tap "Check a product idea" 4; expect "Product idea" 20
type_into "e.g. heated pet bed with timer" "Phone mount for rideshare drivers"
type_into "24.99" "350"; type_into "6.50" "300"
tap "Should I sell this?" 3; seek "Skip it at this price"; shot product-check; screen "Product check"
seek "Is it trending?"; seek "Cheap test plan"
adb shell input keyevent KEYCODE_BACK; sleep 2
# Ask StockPilot: the on-phone brain answers from the store's own numbers, and explains how.
tap "Ask a question" 4; tap "What should I reorder?" 4; seek "How I worked this out" 3; shot ask; screen "Ask"
type_into "Ask about your store…" "why did sales drop this week"; tap "Send" 4; seek "the same days last week" 3
# The follow-up keeps the question ("why…") and moves it to last month, compared with the month before.
before_last=$(date -u -d "$(date -u +%Y-%m-01) -2 month" +%B)
type_into "Ask about your store…" "and last month"; tap "Send" 4; seek "in $before_last" 3; shot ask-follow-up; screen "Ask follow-up"
adb shell input keyevent KEYCODE_BACK; sleep 2
# Listing Writer without AI.
tap "Write a listing" 4; type_into "e.g. Self-cleaning slicker brush" "No-pull dog harness"
tap "Write listing" 3; seek "Bullet points"; shot listing; screen "Listing"
adb shell input keyevent KEYCODE_BACK; sleep 2
tap "Home" 3; tap "Account" 3; expect "Your store" 20
tap "Import sales or stock" 3; expect "Where do you sell?" 20
tap "Amazon" 3; tap "No file yet? Try a sample" 10; seek "Looks right: import" 5; shot import-preview; screen "Import preview"
tap "Looks right: import" 8; seek "See my dashboard" 3; alive; shot import-done; screen "Import done"
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
  seek "Looks right: import" 5; screen "Own file preview"; tap "Looks right: import" 6; seek "See my dashboard" 3; shot own-file-done; screen "Own file imported"
else
  echo "NOTE: could not drive the system file picker on this emulator; skipped the own-file step."; screen "Picker"; adb shell input keyevent KEYCODE_BACK; sleep 2
fi
alive
# Reopen the app: on-phone data must still be there.
adb shell am force-stop "$PKG"; sleep 2; adb shell am start -n "$PKG/.MainActivity"
expect "This week's plan" 90; seek "Profit after fees"; shot reopened; screen "After reopening"
# Excel through the importer (SheetJS on the phone).
tap "Home" 3; tap "Account" 3; tap "Import sales or stock" 3; expect "Where do you sell?" 20
tap "My own spreadsheet" 3; tap "No file yet? Try a sample" 8; seek "Looks right: import" 5; screen "Excel preview"
tap "Looks right: import" 6; seek "See my dashboard" 3; alive; shot excel-done; screen "Excel imported"
tap "See my dashboard" 3; seek "Profit after fees" 5
# A big store: 554 products. Time each screen on the phone.
ms() { date +%s%3N; }
tap "Home" 3; tap "Account" 3; tap "Load big demo store" 2; tap "Replace my data" 1
t0=$(ms); expect "Urban Nest" 120; seek "Profit after fees"; echo "TIMING big store loaded and Home shown: $(( $(ms) - t0 )) ms"; alive; shot big-home; screen "Big store home"
t0=$(ms); tap "Forecast" 1; expect "Expected revenue" 120; echo "TIMING Forecast tab (first time, 200 products on Free): $(( $(ms) - t0 )) ms"; seek "tracked yet"; shot big-forecast; screen "Big store forecast"; to_top "Next week"
tap "Tools" 3; t0=$(ms); tap "See what to order" 1; expect "Total at cost price" 120; echo "TIMING Supplier orders: $(( $(ms) - t0 )) ms"; shot big-orders; screen "Big store orders"
adb shell input keyevent KEYCODE_BACK; sleep 2
# Pro (test switch), then the Pro-only parts.
tap "Upgrade to Pro" 3; seek "Products tracked" 3; shot paywall; tap "Try Pro on this phone" 3
t0=$(ms); tap "Forecast" 1; expect "Expected revenue" 120; echo "TIMING Forecast tab on Pro (554 products): $(( $(ms) - t0 )) ms"; alive
tap "Export forecasts to spreadsheet" 4; shot export-share-sheet; screen "Share sheet"; alive; adb shell input keyevent KEYCODE_BACK; sleep 2
tap "Home" 3; seek "Your money makers"; seek "Bought together"; shot pro-home; screen "Pro home"
tap "Tools" 3; t0=$(ms); tap "Find my profit leaks" 1; expect "Slipping away a month" 120; echo "TIMING Profit leaks (554 products): $(( $(ms) - t0 )) ms"
seek "Export leaks to spreadsheet"; shot pro-leaks; adb shell input keyevent KEYCODE_BACK; sleep 2
# Reopen with the big store: remembered forecasts should make it quick.
adb shell am force-stop "$PKG"; sleep 2; t0=$(ms); adb shell am start -n "$PKG/.MainActivity"
expect "Urban Nest" 120; echo "TIMING reopen to Home (big store): $(( $(ms) - t0 )) ms"
t0=$(ms); tap "Forecast" 1; expect "Expected revenue" 120; echo "TIMING Forecast tab after reopening: $(( $(ms) - t0 )) ms"; alive
adb logcat -d -s ReactNativeJS:V AndroidRuntime:E > "$OUT/logcat.txt"
if grep -E "FATAL EXCEPTION|Unhandled (JS )?Exception|TypeError|ReferenceError" "$OUT/logcat.txt"; then fail "errors in the log"; fi
echo "SMOKE OK"
