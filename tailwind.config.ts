import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Custom medical colors
        "medical-blue": "hsl(var(--medical-blue))",
        "medical-blue-light": "hsl(var(--medical-blue-light))",
        "medical-blue-dark": "hsl(var(--medical-blue-dark))",
        "alert-amber": "hsl(var(--alert-amber))",
        "alert-amber-light": "hsl(var(--alert-amber-light))",
        "alert-amber-border": "hsl(var(--alert-amber-border))",
        "success": "hsl(var(--success))",
        "success-light": "hsl(var(--success-light))",
        "patient-active": "hsl(var(--patient-active))",
        "patient-active-border": "hsl(var(--patient-active-border))",
        "soap-card": "hsl(var(--soap-card))",
        "whatsapp-green": "hsl(var(--whatsapp-green))",
        "whatsapp-light": "hsl(var(--whatsapp-light))",
        "record-red": "hsl(var(--record-red))",
        "record-red-hover": "hsl(var(--record-red-hover))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-record": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.05)", opacity: "0.9" },
        },
        "slide-in-right": {
          from: { transform: "translateX(20px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "fade-in-up": {
          from: { transform: "translateY(10px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "blob": {
          "0%, 100%": { transform: "translate(0px, 0px) scale(1)" },
          "33%": { transform: "translate(40px, -60px) scale(1.12)" },
          "66%": { transform: "translate(-30px, 30px) scale(0.92)" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-12px)" },
        },
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "shimmer": {
          "100%": { transform: "translateX(100%)" },
        },
        "type-cursor": {
          "0%, 50%": { opacity: "1" },
          "51%, 100%": { opacity: "0" },
        },
        "marquee": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-record": "pulse-record 2s ease-in-out infinite",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "fade-in-up": "fade-in-up 0.4s ease-out",
        "blob": "blob 14s ease-in-out infinite",
        "blob-slow": "blob 20s ease-in-out infinite",
        "float": "float 6s ease-in-out infinite",
        "gradient-shift": "gradient-shift 8s ease infinite",
        "shimmer": "shimmer 2.4s ease-in-out infinite",
        "type-cursor": "type-cursor 1s step-end infinite",
        "marquee": "marquee 40s linear infinite",
      },
      boxShadow: {
        "medical": "0 4px 20px -4px hsl(var(--medical-blue) / 0.15)",
        "card-hover": "0 8px 30px -8px hsl(var(--foreground) / 0.1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
