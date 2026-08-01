#!/usr/bin/env bash
# Deploy the Xbox package to the console over the Device Portal REST API and read back
# the app's own diagnostics. Everything the on-console iteration loop needs, in one call:
#
#   ./xdeploy.sh deploy   # uninstall + install + launch  (needs ~/Downloads/ff4e-xbox)
#   ./xdeploy.sh launch   # just (re)launch
#   ./xdeploy.sh log      # boot.log
#   ./xdeploy.sh pad      # pad.log (native + in-page controller diagnostics)
#   ./xdeploy.sh crash    # crash.log (survives relaunches, unlike boot.log)
#   ./xdeploy.sh ps       # is it running?
#
# Credentials live in /tmp/.xdp as user:pass (mode 600).
set -uo pipefail

XB=${XB:-https://192.168.88.13:11443}
CRED=$(cat /tmp/.xdp)
D=${D:-$HOME/Downloads/ff4e-xbox}
PFN='FF4E.FishFillets4ever_1.0.14.0_x64__02mpwfnn4k234'
FAMILY='FF4E.FishFillets4ever_02mpwfnn4k234'
CJ=/tmp/xdp-cookies.txt

tok() {
  rm -f "$CJ"
  curl -sS -k -m 20 -c "$CJ" --user "$CRED" -o /dev/null "$XB/api/os/machinename"
  awk '/CSRF-Token/{print $7}' "$CJ"
}

file() { # $1 = filename in LocalState
  curl -sS -k -m 30 --user "$CRED" -G \
    --data-urlencode "knownfolderid=LocalAppData" \
    --data-urlencode "packagefullname=$PFN" \
    --data-urlencode "path=\\LocalState" \
    --data-urlencode "filename=$1" \
    "$XB/api/filesystem/apps/file" 2>/dev/null
}

launch() {
  local t aid pkg
  t=$(tok)
  aid=$(printf '%s!App' "$FAMILY" | base64)
  pkg=$(printf '%s' "$FAMILY" | base64)
  curl -sS -k -m 60 -b "$CJ" -H "X-CSRF-Token: $t" -H "Content-Length: 0" \
    --user "$CRED" -X POST --data "" -o /dev/null -w "launch    HTTP %{http_code}\n" \
    "$XB/api/taskmanager/app?appid=$aid&package=$pkg"
}

case "${1:-deploy}" in
  deploy)
    t=$(tok)
    curl -sS -k -m 120 -b "$CJ" -H "X-CSRF-Token: $t" --user "$CRED" -X DELETE \
      -o /dev/null -w "uninstall HTTP %{http_code}\n" \
      "$XB/api/app/packagemanager/package?package=$PFN"
    sleep 3
    t=$(tok)
    curl -sS -k --max-time 900 -b "$CJ" -H "X-CSRF-Token: $t" --user "$CRED" -X POST \
      -o /dev/null -w "install   HTTP %{http_code}\n" \
      "$XB/api/app/packagemanager/package?package=Ff4eXbox_1.0.14.0_x64.msix" \
      -F "Ff4eXbox_1.0.14.0_x64.msix=@$D/Ff4eXbox_1.0.14.0_x64.msix" \
      -F "Microsoft.UI.Xaml.2.8.appx=@$D/Dependencies/Microsoft.UI.Xaml.2.8.appx" \
      -F "Microsoft.NET.Native.Framework.2.2.appx=@$D/Dependencies/Microsoft.NET.Native.Framework.2.2.appx" \
      -F "Microsoft.NET.Native.Runtime.2.2.appx=@$D/Dependencies/Microsoft.NET.Native.Runtime.2.2.appx" \
      -F "Microsoft.VCLibs.x64.14.00.appx=@$D/Dependencies/Microsoft.VCLibs.x64.14.00.appx" \
      -F "Microsoft.VCLibs.x64.14.00.Desktop.appx=@$D/Dependencies/Microsoft.VCLibs.x64.14.00.Desktop.appx" \
      -F "ff4e.cer=@$D/ff4e.cer"
    for _ in $(seq 1 60); do
      r=$(curl -sS -k -m 20 --user "$CRED" "$XB/api/app/packagemanager/state" 2>/dev/null)
      if echo "$r" | grep -q '"Success" : true'; then echo "deploy    ok"; break; fi
      if echo "$r" | grep -qi '"Success" : false'; then echo "deploy    FAILED: $r"; exit 1; fi
      sleep 5
    done
    launch
    ;;
  launch) launch ;;
  log)    file boot.log ;;
  pad)    file pad.log ;;
  crash)  file crash.log ;;
  ps)
    curl -sS -k -m 30 --user "$CRED" "$XB/api/resourcemanager/processes" 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
app = [p for p in d.get('Processes', []) if 'ff4e' in (p.get('ImageName') or '').lower()]
wv = [p for p in d.get('Processes', []) if 'msedgewebview' in (p.get('ImageName') or '').lower()]
print('Ff4eXbox.exe:', app[0]['ProcessId'] if app else 'NOT RUNNING', '| webview procs:', len(wv))
"
    ;;
  *) echo "usage: $0 {deploy|launch|log|pad|crash|ps}"; exit 2 ;;
esac
