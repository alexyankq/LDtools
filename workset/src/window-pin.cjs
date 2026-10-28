// Verify the Win32 flag: Electron's cached z-order can disagree with Windows.
let native;
function windowsAPI() {
  if (!native) {
    const user32 = require('koffi').load('user32.dll');
    native = {
      getStyle: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
      setPosition: user32.func('int __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int width, int height, uint32_t flags)')
    };
  }
  return native;
}
function handle(win) {
  const buffer = win.getNativeWindowHandle();
  return buffer.length === 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE());
}
function isPinned(win) {
  if (process.platform !== 'win32') return win.isAlwaysOnTop();
  return (Number(windowsAPI().getStyle(handle(win), -20)) & 0x00000008) !== 0;
}
function setPinned(win, enabled) {
  // On Windows, Electron's default "floating" level moves the window behind
  // Shell_TrayWnd on every focus. A non-topmost taskbar demotes our window too.
  // This level keeps the window in the topmost band across activation changes.
  win.setAlwaysOnTop(enabled, process.platform === 'win32' ? 'pop-up-menu' : 'floating');
  if (process.platform === 'win32' && isPinned(win) !== enabled) {
    // NOMOVE | NOSIZE | NOACTIVATE: preserve the user's window and focus.
    const success = windowsAPI().setPosition(handle(win), enabled ? -1n : -2n, 0, 0, 0, 0, 0x0013);
    if (!success || isPinned(win) !== enabled) throw new Error('Windows 未能应用窗口置顶设置，请重试');
  }
}
module.exports = { setPinned, isPinned };
