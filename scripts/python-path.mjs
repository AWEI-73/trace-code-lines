import {spawnSync} from 'node:child_process';

export function resolvePython() {
  const explicit = process.env.TRACE_PYTHON !== undefined;
  const candidates = explicit ? [process.env.TRACE_PYTHON] : ['python3', 'python'];
  const failures = [];
  for (const candidate of candidates) {
    const probe = candidate ? spawnSync(candidate, ['-c', 'import sys; print(sys.version_info.major); print(sys.executable)'], {
      encoding: 'utf8', timeout: 10000, windowsHide: true,
      env: {...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1'}
    }) : {status: null, error: new Error('empty executable')};
    const lines = (probe.stdout || '').trim().split(/\r?\n/);
    if (!probe.error && probe.status === 0 && lines[0] === '3' && lines[1]) return lines[1];
    failures.push(JSON.stringify(candidate) + ': ' + (probe.error?.message || 'exit=' + probe.status + ', major=' + (lines[0] || 'UNKNOWN')));
    if (explicit) break;
  }
  throw new Error('\u8acb\u8a2d\u5b9a TRACE_PYTHON \u6307\u5411 Python 3; ' + failures.join('; '));
}
