#!/bin/zsh

set -u

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

script_path="${0:A}"
macos_dir="${script_path:h}"
site_root="${macos_dir:h:h}"
runtime_root="${site_root}/.local-runtime"
log_root="${runtime_root}/logs"
pid_file="${runtime_root}/manager.pid"
lock_dir="${runtime_root}/start.lock"
local_url="http://127.0.0.1:3001"
date_stamp="$(/bin/date +%Y-%m-%d)"
log_file="${log_root}/us-lens-${date_stamp}.log"

/bin/mkdir -p "${log_root}"
/usr/bin/find "${log_root}" -type f -name '*.log' -mtime +7 -delete 2>/dev/null

show_error() {
  /usr/bin/osascript -e 'display dialog "US LENS 本地服务启动失败。已为你打开日志。" buttons {"好"} default button "好" with icon stop' >/dev/null 2>&1
  /usr/bin/open -a TextEdit "${log_file}" >/dev/null 2>&1
}

manager_is_running() {
  [[ -f "${pid_file}" ]] || return 1
  manager_pid="$(<"${pid_file}")"
  [[ "${manager_pid}" == <-> ]] || return 1
  /bin/kill -0 "${manager_pid}" 2>/dev/null || return 1
  manager_command="$(/bin/ps -p "${manager_pid}" -o command= 2>/dev/null)"
  [[ "${manager_command}" == *"us-lens-local-manager"* || "${manager_command}" == *"local-server.mjs"* ]]
}

page_is_ready() {
  /usr/bin/curl --silent --fail --max-time 1 "${local_url}" >/dev/null 2>&1
}

open_page() {
  if [[ "${US_LENS_NO_OPEN:-0}" != "1" ]]; then
    /usr/bin/open "${local_url}" >/dev/null 2>&1
  fi
}

wait_for_existing_manager() {
  for _ in {1..120}; do
    if page_is_ready; then
      open_page
      return 0
    fi
    manager_is_running || return 1
    /bin/sleep 0.5
  done
  return 1
}

release_lock() {
  /bin/rmdir "${lock_dir}" >/dev/null 2>&1 || true
}

if manager_is_running; then
  if wait_for_existing_manager; then
    exit 0
  fi
  show_error
  exit 1
fi

/bin/rm -f "${pid_file}"

if ! /bin/mkdir "${lock_dir}" 2>/dev/null; then
  for _ in {1..40}; do
    if manager_is_running && wait_for_existing_manager; then
      exit 0
    fi
    /bin/sleep 0.25
  done
  /bin/rmdir "${lock_dir}" >/dev/null 2>&1 || true
  if ! /bin/mkdir "${lock_dir}" 2>/dev/null; then
    show_error
    exit 1
  fi
fi
trap release_lock EXIT

if /usr/sbin/lsof -nP -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
  print -r -- "端口 3001 已被其他程序占用。" >> "${log_file}"
  show_error
  exit 1
fi

node_bin=""
npm_bin=""
for candidate in /usr/local/bin/node /opt/homebrew/bin/node; do
  if [[ -x "${candidate}" ]]; then
    node_bin="${candidate}"
    break
  fi
done

for candidate in /usr/local/bin/npm /opt/homebrew/bin/npm; do
  if [[ -x "${candidate}" ]]; then
    npm_bin="${candidate}"
    break
  fi
done

if [[ -z "${node_bin}" || -z "${npm_bin}" ]]; then
  print -r -- "未找到 Node.js 或 npm。" >> "${log_file}"
  show_error
  exit 1
fi

cd -- "${site_root}" || exit 1
if ! "${node_bin}" scripts/launch-local-manager.mjs "${log_file}" "${pid_file}" "${npm_bin}"; then
  print -r -- "无法创建本地服务管理进程。" >> "${log_file}"
  show_error
  exit 1
fi
manager_pid="$(<"${pid_file}")"

for _ in {1..240}; do
  if page_is_ready; then
    open_page
    exit 0
  fi
  if ! /bin/kill -0 "${manager_pid}" 2>/dev/null; then
    /bin/rm -f "${pid_file}"
    show_error
    exit 1
  fi
  /bin/sleep 0.5
done

print -r -- "本地服务启动超时。" >> "${log_file}"
/bin/kill -TERM "${manager_pid}" 2>/dev/null || true
/bin/rm -f "${pid_file}"
show_error
exit 1
