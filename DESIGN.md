---
name: Light Pixel
description: Light canvas converter UI with pixel display type, monospace UI, and a warm orange accent — aligned with akhsanhakiki portfolio.
colors:
  canvas: "#FAF9F6"
  ink: "#111111"
  accent: "#FF5A1F"
  surface: "#FFFFFF"
  ink-muted: "#111111BF"
  ink-soft: "#11111199"
  ink-faint: "#11111180"
  rule: "#1111111A"
  rule-strong: "#1111111F"
  nav-glass: "#FAF9F6D9"
  success: "#1A7A3A"
  danger: "#B42318"
typography:
  display:
    fontFamily: "Geist Pixel Square"
    fontSize: "clamp(32px, 8vw, 56px)"
    fontWeight: 500
    lineHeight: 0.95
    letterSpacing: "-0.01em"
  section:
    fontFamily: "Geist Pixel Square"
    fontSize: "clamp(20px, 4vw, 28px)"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  body:
    fontFamily: "JetBrains Mono"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "JetBrains Mono"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.08em"
  nav:
    fontFamily: "JetBrains Mono"
    fontSize: "12px"
    letterSpacing: "0.05em"
rounded:
  none: "0px"
spacing:
  page-x: "clamp(16px, 4vw, 40px)"
  section-y: "clamp(28px, 5vw, 56px)"
  stack-lg: "32px"
  stack-md: "20px"
  stack-sm: "12px"
components:
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    rounded: "{rounded.none}"
    padding: "14px 20px"
layout:
  max-app: "720px"
  grid-size: "120px"
---

# Design System

Converter is a **product** surface: restrained Light Pixel chrome, single-column task flow, settings behind disclosure. Zero radius, hairline rules, orange accent only on primary action and status marks.
