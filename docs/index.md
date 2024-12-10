---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "localtunnels"
  text: "For a better local environment."
  tagline: "Easily expose your local server to the world."
  image:
    src: /logo.png
    alt: Stacks Local Tunnels
  actions:
    - theme: brand
      text: Documentation
      link: /intro
    - theme: alt
      text: View on GitHub
      link: https://github.com/stacksjs/localtunnels

features:
  - title: "Smart Local Tunnel"
    icon: "🚇"
    details: "Automatically detects your local server and exposes it to the world."
  - title: "HTTPS Support"
    icon: "🔒"
    details: "Automatic, and configurable, HTTPS support."
  - title: "Custom Subdomains"
    icon: "🌐"
    details: "Use custom subdomains for your tunnels."
  - title: "CLI & Library"
    icon: "🛠"
    details: "Use the CLI or the library in your own project."
---

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(
    120deg,
    #0a0abc,
    #24a0ff
  );
  --vp-home-hero-image-background-image: linear-gradient(-45deg, #0a0abc 50%, #24a0ff 50%);
  --vp-home-hero-image-filter: blur(44px);
}

@media (min-width: 640px) {
  :root {
    --vp-home-hero-image-filter: blur(56px);
  }
}

@media (min-width: 960px) {
  :root {
    --vp-home-hero-image-filter: blur(68px);
  }
}
</style>
