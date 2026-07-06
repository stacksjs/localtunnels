---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "localtunnels"
  text: "For a better local environment."
  tagline: "Easily expose your local server to the world."
  image:
    src: /images/logo-white.png
    alt: Stacks Local Tunnels
  actions:
    - theme: brand
      text: Get Started
      link: /intro
    - theme: alt
      text: View on GitHub
      link: https://github.com/stacksjs/localtunnels

features:
  - title: "Smart Local Tunnel"
    icon: "🚇"
    details: "Automatically detects your local server and exposes it to the world — binary-safe, with proxy headers."
  - title: "HTTPS Support"
    icon: "🔒"
    details: "Automatic, and configurable, HTTPS support."
  - title: "Custom Subdomains"
    icon: "🌐"
    details: "Memorable random names or your own subdomain, with auto-collision handling."
  - title: "Self-Hostable Anywhere"
    icon: "☁️"
    details: "One-command IaC deploys to AWS or Hetzner via ts-cloud."
  - title: "WireGuard-style VPN"
    icon: "🛡"
    details: "Join machines into a private, encrypted layer-3 mesh, powered by a native Zig core."
  - title: "CLI & Library"
    icon: "🛠"
    details: "Use the CLI or the library in your own project."
---