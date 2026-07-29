on run
  try
    set managerPid to do shell script "/usr/bin/pgrep -x us-lens-local-manager | /usr/bin/head -n 1"
  on error
    display notification "本地服务当前未运行" with title "US LENS"
    return
  end try

  do shell script "/bin/kill -TERM " & quoted form of managerPid
  display notification "本地服务已停止" with title "US LENS"
end run
