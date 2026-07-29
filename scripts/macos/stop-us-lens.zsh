#!/bin/zsh

set -u

script_path="${0:A}"
macos_dir="${script_path:h}"
site_root="${macos_dir:h:h}"
runtime_root="${site_root}/.local-runtime"
pid_file="${runtime_root}/manager.pid"
lock_dir="${runtime_root}/start.lock"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"US LENS\"" >/dev/null 2>&1
}

if [[ ! -f "${pid_file}" ]]; then
  notify "本地服务当前未运行"
  exit 0
fi

manager_pid="$(<"${pid_file}")"
if [[ "${manager_pid}" != <-> ]]; then
  /bin/rm -f "${pid_file}"
  /bin/rmdir "${lock_dir}" >/dev/null 2>&1 || true
  notify "已清理失效的本地服务记录"
  exit 0
fi

manager_command="$(/bin/ps -p "${manager_pid}" -o command= 2>/dev/null)"
if [[ "${manager_command}" != *"us-lens-local-manager"* && "${manager_command}" != *"local-server.mjs"* ]]; then
  /bin/rm -f "${pid_file}"
  /bin/rmdir "${lock_dir}" >/dev/null 2>&1 || true
  notify "已清理失效的本地服务记录"
  exit 0
fi

/bin/kill -TERM "${manager_pid}" 2>/dev/null || true

for _ in {1..100}; do
  if ! /bin/kill -0 "${manager_pid}" 2>/dev/null; then
    /bin/rm -f "${pid_file}"
    /bin/rmdir "${lock_dir}" >/dev/null 2>&1 || true
    notify "本地服务已停止"
    exit 0
  fi
  /bin/sleep 0.1
done

manager_command="$(/bin/ps -p "${manager_pid}" -o command= 2>/dev/null)"
if [[ "${manager_command}" == *"us-lens-local-manager"* || "${manager_command}" == *"local-server.mjs"* ]]; then
  /bin/kill -KILL "${manager_pid}" 2>/dev/null || true
fi

/bin/rm -f "${pid_file}"
/bin/rmdir "${lock_dir}" >/dev/null 2>&1 || true
notify "本地服务已停止"
