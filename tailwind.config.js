/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        kanit: ['Kanit', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
      },
      colors: {
        mason: {
          black: '#111111',
          dark: '#1C1C1C',
          gray: {
            900: '#1A1A1A',
            800: '#2D2D2D',
            700: '#3D3D3D',
            600: '#525252',
            500: '#6B6B6B',
            400: '#8A8A8A',
            300: '#ABABAB',
            200: '#C8C8C8',
            100: '#E5E5E5',
            50:  '#F4F4F4',
          },
        },
        risk: {
          high:   '#DC2626',
          medium: '#D97706',
          low:    '#16A34A',
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.4s ease-out both',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
