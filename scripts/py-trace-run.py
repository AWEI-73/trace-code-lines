"""Standard-library tracing wrapper. Runtime hooks are not an OS sandbox."""
import sys
import os
import json
import time
import runpy
import threading
import builtins
import io
import socket
import subprocess
import shutil
import traceback
from pathlib import Path

if sys.argv[1:] == ["--help"]:
    print("Usage: python py-trace-run.py --out directory --config file -- script|module [args]")
    sys.exit(0)
sys.excepthook = lambda kind, value, tb: print(str(value), file=sys.stderr)
args = sys.argv[1:]
separator = args.index("--")
opts, target = args[:separator], args[separator + 1:]
out = opts[opts.index("--out") + 1]
config_file = opts[opts.index("--config") + 1]
original_open = builtins.open
with original_open(config_file, encoding="utf-8") as stream:
    config = json.load(stream)
active = config["mode"] == "active"
pid = os.getpid()
event_file = os.path.join(config["eventsDirectory"], str(pid) + ".jsonl")
counts = {}
sequence = 0
guard = threading.local()
roots = config["writeRoots"] + [config["outputDirectory"]]
original_lstat = os.lstat
original_exists = os.path.lexists
this_file = os.path.normcase(os.path.abspath(__file__))


def norm(p):
    return os.path.normcase(os.path.abspath(os.fspath(p)))


def inside(root, p):
    try:
        return os.path.commonpath([norm(root), norm(p)]) == norm(root)
    except (ValueError, TypeError):
        return False


def safe(p):
    if isinstance(p, int) or p is None:
        return False
    if not any(inside(r, p) for r in roots):
        return False
    q = norm(p)
    while True:
        if original_exists(q):
            import stat
            st = original_lstat(q)
            if stat.S_ISLNK(st.st_mode) or getattr(st, "st_file_attributes", 0) & 0x400:
                return False
        parent = os.path.dirname(q)
        if parent == q:
            break
        q = parent
    return True


def emit(event):
    event.update(at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), pid=pid, cwd=os.getcwd())
    try:
        raw_os_write(log_fd, (json.dumps(event, ensure_ascii=True) + "\n").encode("utf-8"))
    except Exception:
        if active:
            raise


def start(kind, api, detail, allowed=True):
    global sequence
    sequence += 1
    stack = [{"file": f.filename, "line": f.lineno, "function": f.name}
             for f in traceback.extract_stack()[:-1] if norm(f.filename) != this_file]
    event = dict(id=str(pid) + ":" + str(sequence), kind=kind, api=api,
                 decision="DENY" if active and not allowed else "ALLOW",
                 phase="attempt", stack=stack, **detail)
    emit(event.copy())
    if event["decision"] == "DENY":
        if any(p and any(inside(r, p) for r in config.get("stopOnDeniedRoots", [])) for p in event.get("paths", [])):
            with original_open(os.path.join(config["eventsDirectory"], "STOP_PROTECTED_DENY.json"), "w", encoding="utf-8") as stream:
                json.dump(event, stream)
        error = PermissionError("INSTRUMENT_DENIED: " + api)
        error.code = "INSTRUMENT_DENIED"
        raise error
    return event


raw_os_write = os.write
log_fd = os.open(event_file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)

def own_executable(p):
    if not config.get("allowCreatedExecutables") or not safe(p) or not original_exists(p):
        return False
    for name in os.listdir(config["eventsDirectory"]):
        if not name.endswith(".jsonl"):
            continue
        with original_open(os.path.join(config["eventsDirectory"], name), encoding="utf-8") as stream:
            for line in stream:
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if event.get("decision") == "ALLOW" and (event.get("phase") == "success" or event.get("audit")):
                    if any(norm(q) == norm(p) for q in event.get("createdPaths", [])):
                        return True
    return False

def audit(event, args):
    if getattr(guard, "busy", False):
        return
    guard.busy = True
    try:
        if event == "open":
            p, mode, flags = args
            writing = any(c in str(mode or "") for c in "wax+") or bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC))
            if writing:
                paths = [norm(p)] if not isinstance(p, int) else []
                start("write", "audit.open", dict(paths=paths, mode=mode, flags=flags, audit=True, writeIntent=True,
                      createdPaths=[q for q in paths if not original_exists(q)]), isinstance(p, int) or safe(p))
        elif event in ("os.rename", "os.remove", "os.rmdir", "os.mkdir", "os.link", "os.symlink", "os.chmod", "os.utime", "os.truncate") or event.startswith("shutil."):
            if event in ("os.rename", "os.link", "os.symlink", "shutil.move"):
                candidates = args[:2]
            elif event.startswith("shutil.") and event != "shutil.rmtree":
                candidates = args[1:2]
            else:
                candidates = args[:1]
            paths = [norm(q) for q in candidates if isinstance(q, (str, bytes, os.PathLike))]
            dir_fds = args[2:] if event == "os.rename" else args[1:2] if event in ("os.remove", "os.rmdir") else args[2:3] if event == "os.mkdir" else ()
            allowed = all(safe(q) for q in paths) and not any(isinstance(q, int) and q != -1 for q in dir_fds) and event != "os.symlink"
            start("write", "audit." + event, dict(paths=paths, audit=True, writeIntent=event in ("os.rename", "os.mkdir", "shutil.copyfile", "shutil.copytree", "shutil.move"),
                  createdPaths=[q for q in paths if not original_exists(q)]), allowed)
        elif event == "subprocess.Popen":
            executable, argv, cwd, env = args
            # Windows audits the normalized command line and may leave executable None.
            import re
            if executable is None:
                match = re.match(r'^\s*(?:"([^"]+)"|(\S+))', argv) if isinstance(argv, str) else None
                executable = (match.group(1) or match.group(2)) if match else argv[0] if isinstance(argv, (list, tuple)) and argv else ""
            resolved = shutil.which(executable, path=(env or os.environ).get("PATH")) or executable
            created = own_executable(resolved)
            allowed = (any(norm(p) == norm(resolved) for p in config["executables"]) or created) and not any(re.search(p, str(argv), re.I) for p in config.get("denyCommandPatterns", []))
            # The audit seam cannot rewrite argv. Require inheritance for known instrumentable children.
            child_env = env if env is not None else os.environ
            is_node = norm(resolved) == norm(config["nodeExecutable"])
            is_python = any(norm(p) == norm(resolved) for p in config["pythonExecutables"])
            if is_node and config["recorder"].replace("\\", "/") not in child_env.get("NODE_OPTIONS", ""):
                allowed = False
            if is_python and config.get("wrapPythonChildren") and config["pythonWrapper"] not in str(argv):
                allowed = False
            start("process", event, dict(argv=argv, resolvedExecutable=resolved, createdExecutable=created, childCwd=str(cwd or os.getcwd()), audit=True), allowed)
        elif event == "os.system" or event.startswith(("os.exec", "os.spawn", "os.startfile")):
            start("process", event, dict(argv=[str(x) for x in args], audit=True), False)
        elif event in ("socket.connect", "socket.bind", "socket.getaddrinfo"):
            address = args[1] if event != "socket.getaddrinfo" else args[0]
            host = address[0] if isinstance(address, tuple) else address
            allowed = config.get("network") == "loopback" and host in ("localhost", "127.0.0.1", "::1")
            start("network", event, dict(host=host, address=str(address), audit=True), allowed)
    finally:
        guard.busy = False

sys.addaudithook(audit)

trace_files = {}


def trace(frame, event, arg):
    # Global callback runs on function entry; excluded frames need no line callbacks.
    if event != "call":
        return None
    filename = frame.f_code.co_filename
    if filename not in trace_files:
        resolved = None
        if not filename.startswith("<") and norm(filename) != this_file and not inside(config["outputDirectory"], filename):
            if any(inside(root, filename) for root in roots + [config["cwd"]]):
                resolved = os.path.abspath(filename)
        trace_files[filename] = resolved
    resolved = trace_files[filename]
    if resolved is None:
        return None
    def lines(frame, event, arg):
        if event == "line":
            key = (resolved, frame.f_lineno)
            counts[key] = counts.get(key, 0) + 1
        return lines
    return lines


emit(dict(kind="lifecycle", api="python.recorder.ready", phase="success", decision="ALLOW", originalArgv=target))
sys.settrace(trace)
threading.settrace(trace)
try:
    if not target:
        raise ValueError("No script/module/code supplied")
    if target[0] == "-m":
        sys.argv = [target[1]] + target[2:]
        runpy.run_module(target[1], run_name="__main__", alter_sys=True)
    elif target[0] == "-c":
        sys.argv = ["-c"] + target[2:]
        exec(compile(target[1], "<string>", "exec"), {"__name__": "__main__", "__builtins__": builtins})
    elif target[0] == "-":
        sys.argv = ["-"] + target[1:]
        exec(compile(sys.stdin.read(), "<stdin>", "exec"), {"__name__": "__main__", "__builtins__": builtins})
    else:
        sys.argv = target[:]
        if not sys.flags.isolated:
            sys.path.insert(0, os.path.dirname(os.path.abspath(target[0])))
        runpy.run_path(target[0], run_name="__main__")
finally:
    sys.settrace(None)
    threading.settrace(None)
    files = {}
    for (filename, line), count in sorted(counts.items()):
        files.setdefault(filename, []).append({"line": line, "count": count})
    result = {"schema": "python-settrace-v1", "pid": pid, "files": [
        {"path": filename, "lines": lines} for filename, lines in files.items()]}
    with original_open(os.path.join(out, "python-" + str(pid) + ".json"), "w", encoding="utf-8", newline="\n") as stream:
        json.dump(result, stream, ensure_ascii=True)
        stream.write("\n")
