/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0f0d1b',
          card: '#1a1727',
          'card-hover': '#1f1b30',
          sidebar: '#13111f',
          border: '#2a2740',
          'border-light': '#352f50',
          hover: '#231f35',
          muted: '#8b85a0',
          accent: '#7c5bf5',
          'accent-light': '#9d85ff',
          surface: '#16132a',
        },
      },
      boxShadow: {
        glow: '0 0 20px rgba(124, 91, 245, 0.15)',
        'glow-sm': '0 0 10px rgba(124, 91, 245, 0.1)',
        'glow-lg': '0 0 40px rgba(124, 91, 245, 0.2)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.3)',
        'card-hover': '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(124, 91, 245, 0.08)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-border': 'linear-gradient(135deg, rgba(124,91,245,0.3), rgba(124,91,245,0.05))',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 15px rgba(124, 91, 245, 0.1)' },
          '50%': { boxShadow: '0 0 25px rgba(124, 91, 245, 0.25)' },
        },
      },
    },
  },
  plugins: [],
}
