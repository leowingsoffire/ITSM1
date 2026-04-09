/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0f0d1b',
          card: '#1a1727',
          sidebar: '#13111f',
          border: '#2a2740',
          hover: '#231f35',
          muted: '#8b85a0',
          accent: '#7c5bf5',
        },
      },
    },
  },
  plugins: [],
}
