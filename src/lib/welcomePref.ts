const KEY = 'slapchop.welcomeDismissed';

export function getWelcomeDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setWelcomeDismissed(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(KEY, '1');
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // ignore storage errors (private browsing, quota exceeded)
  }
}
