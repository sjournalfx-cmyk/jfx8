const childProcess = require('child_process');

const originalExec = childProcess.exec;
const originalExecFile = childProcess.execFile;

function makeDummyChildProcess() {
  return {
    stdout: null,
    stderr: null,
    stdin: null,
    kill() {
      return true;
    },
    on() {
      return this;
    },
    once() {
      return this;
    },
    removeListener() {
      return this;
    },
  };
}

function shouldBypass(command) {
  return typeof command === 'string' && command.trim().toLowerCase() === 'net use';
}

childProcess.exec = function patchedExec(command, options, callback) {
  if (shouldBypass(command)) {
    const cb = typeof options === 'function' ? options : callback;
    if (typeof cb === 'function') {
      queueMicrotask(() => cb(null, '', ''));
    }
    return makeDummyChildProcess();
  }

  return originalExec.call(this, command, options, callback);
};

childProcess.execFile = function patchedExecFile(file, args, options, callback) {
  if (shouldBypass(file)) {
    const cb = typeof args === 'function'
      ? args
      : typeof options === 'function'
        ? options
        : callback;

    if (typeof cb === 'function') {
      queueMicrotask(() => cb(null, '', ''));
    }

    return makeDummyChildProcess();
  }

  return originalExecFile.call(this, file, args, options, callback);
};
