/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f9fafb',
          100: '#f3f4f6',
          500: '#374151',
          600: '#111827',
          700: '#000000',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
