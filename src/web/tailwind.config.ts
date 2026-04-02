export default {
  content: ['./src/web/**/*.{tsx,ts,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { mono: ['JetBrains Mono', 'Fira Code', 'monospace'] },
      keyframes: {
        'slide-in-top': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-in-top': 'slide-in-top 0.3s ease-out',
      },
    },
  },
};
