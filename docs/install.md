# Install

## Bun & Node.js

```bash
bun install -d localtunnels
npm install -g localtunnels

# or, invoke immediately
bunx localtunnels
npx localtunnels
```

_We are looking to publish this package npm under the name `localtunnels`. We are also hoping npm will release the name for us._

## Binaries

For now, you can download the `localtunnels` binaries from the [releases page](https://github.com/stacksjs/localtunnels/releases/tag/v0.1.1). Choose the binary that matches your platform and architecture:

## macOS (Darwin)

For M1/M2 Macs (arm64):

```bash
# Download the binary
curl -L https://github.com/stacksjs/localtunnels/releases/download/v0.1.0/lpx-darwin-arm64 -o localtunnels

# Make it executable
chmod +x localtunnels

# Move it to your PATH
mv localtunnels /usr/local/bin/localtunnels
```

For Intel Macs (amd64):

```bash
# Download the binary
curl -L https://github.com/stacksjs/localtunnels/releases/download/v0.1.0/lpx-darwin-x64 -o localtunnels

# Make it executable
chmod +x localtunnels

# Move it to your PATH
mv localtunnels /usr/local/bin/localtunnels
```

## Linux

For ARM64:

```bash
# Download the binary
curl -L https://github.com/stacksjs/localtunnels/releases/download/v0.1.0/lpx-linux-arm64 -o localtunnels

# Make it executable
chmod +x localtunnels

# Move it to your PATH
mv localtunnels /usr/local/bin/localtunnels
```

For x64:

```bash
# Download the binary
curl -L https://github.com/stacksjs/localtunnels/releases/download/v0.1.0/lpx-linux-x64 -o localtunnels

# Make it executable
chmod +x localtunnels

# Move it to your PATH
mv localtunnels /usr/local/bin/localtunnels
```

## Windows

For x64:

```bash
# Download the binary
curl -L https://github.com/stacksjs/localtunnels/releases/download/v0.1.0/lpx-windows-x64.exe -o localtunnels.exe

# Move it to your PATH (adjust the path as needed)
move localtunnels.exe C:\Windows\System32\localtunnels.exe
```

<!-- _Alternatively, you can install:_
```bash
brew install localtunnels # wip
pkgx install localtunnels # wip
``` -->
