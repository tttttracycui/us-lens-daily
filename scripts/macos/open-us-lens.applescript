on run
  set appBundlePath to POSIX path of (path to me)
  set launcherPath to appBundlePath & "../04-美股简报网页/scripts/macos/start-us-lens.zsh"
  do shell script "/bin/zsh " & quoted form of launcherPath & " >/dev/null 2>&1 &"
end run
