const themes = {
  dark: {
    '--bg-primary': '#313338',
    '--bg-secondary': '#2b2d31',
    '--bg-tertiary': '#1e1f22',
    '--text-primary': '#dcddde',
    '--text-secondary': '#949ba4',
    '--accent': '#5865F2',
    '--success': '#57F287',
    '--danger': '#ED4245'
  },
  light: {
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f2f3f5',
    '--bg-tertiary': '#e3e5e8',
    '--text-primary': '#2e3338',
    '--text-secondary': '#6d6f78',
    '--accent': '#5865F2',
    '--success': '#57F287',
    '--danger': '#ED4245'
  },
  midnight: {
    '--bg-primary': '#0d1117',
    '--bg-secondary': '#161b22',
    '--bg-tertiary': '#010409',
    '--text-primary': '#c9d1d9',
    '--text-secondary': '#8b949e',
    '--accent': '#58a6ff',
    '--success': '#3fb950',
    '--danger': '#f85149'
  }
};

function applyTheme(themeName) {
  const theme = themes[themeName] || themes.dark;
  Object.entries(theme).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
  localStorage.setItem('theme', themeName);
}

function toggleTheme() {
  const current = localStorage.getItem('theme') || 'dark';
  const next = current === 'dark' ? 'light' : current === 'light' ? 'midnight' : 'dark';
  applyTheme(next);
}

applyTheme(localStorage.getItem('theme') || 'dark');