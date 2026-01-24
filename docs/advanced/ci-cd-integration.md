# CI/CD Integration

This guide covers integrating localtunnels into your CI/CD pipelines for automated testing, deployments, and preview environments.

## Use Cases

- **E2E Testing**: Expose test servers for external service webhooks
- **Preview Deployments**: Create tunnels for PR preview environments
- **Integration Testing**: Test OAuth flows and API callbacks
- **Automated QA**: Enable external testing tools to access CI environments

## GitHub Actions

### Basic Tunnel Setup

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Start application
        run: bun run start &
        env:
          PORT: 3000

      - name: Wait for server
        run: sleep 5

      - name: Start tunnel
        run: |
          bun add -g localtunnels
          localtunnel start --from localhost:3000 --subdomain pr-${{ github.event.pull_request.number }} &
          sleep 3

      - name: Run E2E tests
        run: bun run test:e2e
        env:
          BASE_URL: https://pr-${{ github.event.pull_request.number }}.tunnels.dev
```

### Webhook Testing

```yaml
# .github/workflows/webhook-tests.yml
name: Webhook Integration Tests

on:
  push:
    branches: [main]

jobs:
  webhook-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Start webhook receiver
        run: |
          bun run webhook-server &
          sleep 2

      - name: Create tunnel
        id: tunnel
        run: |
          bun add -g localtunnels
          SUBDOMAIN="webhook-test-${{ github.run_id }}"
          localtunnel start --from localhost:3000 --subdomain $SUBDOMAIN &
          sleep 3
          echo "url=https://$SUBDOMAIN.tunnels.dev" >> $GITHUB_OUTPUT

      - name: Configure webhook
        run: |
          curl -X POST https://api.service.com/webhooks \
            -H "Authorization: Bearer ${{ secrets.API_TOKEN }}" \
            -d '{"url": "${{ steps.tunnel.outputs.url }}/webhook"}'

      - name: Trigger webhook
        run: bun run trigger-webhook-test

      - name: Verify webhook received
        run: bun run verify-webhook
```

### Preview Environments

```yaml
# .github/workflows/preview.yml
name: Preview Deployment

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install and build
        run: |
          bun install
          bun run build

      - name: Start preview server
        run: |
          bun run preview &
          sleep 5

      - name: Create preview tunnel
        id: tunnel
        run: |
          bun add -g localtunnels
          SUBDOMAIN="preview-pr-${{ github.event.pull_request.number }}"
          localtunnel start --from localhost:4173 --subdomain $SUBDOMAIN &
          sleep 3
          echo "url=https://$SUBDOMAIN.tunnels.dev" >> $GITHUB_OUTPUT

      - name: Comment PR with preview URL
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '## Preview Environment\n\nYour preview is ready at: ${{ steps.tunnel.outputs.url }}'
            })
```

## GitLab CI

### Basic Setup

```yaml
# .gitlab-ci.yml
stages:
  - test
  - preview

e2e-tests:
  stage: test
  image: oven/bun:latest
  services:
    - name: your-app:latest
      alias: app
  script:
    - bun add -g localtunnels
    - localtunnel start --from app:3000 --subdomain gitlab-$CI_PIPELINE_ID &
    - sleep 5
    - bun run test:e2e
  variables:
    BASE_URL: https://gitlab-$CI_PIPELINE_ID.tunnels.dev

preview:
  stage: preview
  image: oven/bun:latest
  script:
    - bun install
    - bun run build
    - bun run preview &
    - sleep 5
    - bun add -g localtunnels
    - localtunnel start --from localhost:4173 --subdomain preview-$CI_MERGE_REQUEST_IID &
    - echo "Preview URL: https://preview-$CI_MERGE_REQUEST_IID.tunnels.dev"
    - sleep 3600  # Keep alive for 1 hour
  rules:
    - if: $CI_MERGE_REQUEST_IID
```

## CircleCI

```yaml
# .circleci/config.yml
version: 2.1

jobs:
  e2e-tests:
    docker:
      - image: oven/bun:latest
    steps:
      - checkout

      - run:
          name: Install dependencies
          command: bun install

      - run:
          name: Start application
          command: bun run start
          background: true

      - run:
          name: Wait for app
          command: sleep 5

      - run:
          name: Start tunnel
          command: |
            bun add -g localtunnels
            localtunnel start --from localhost:3000 --subdomain circle-${CIRCLE_BUILD_NUM}
          background: true

      - run:
          name: Wait for tunnel
          command: sleep 5

      - run:
          name: Run E2E tests
          command: bun run test:e2e
          environment:
            BASE_URL: https://circle-${CIRCLE_BUILD_NUM}.tunnels.dev

workflows:
  test:
    jobs:
      - e2e-tests
```

## Jenkins

```groovy
// Jenkinsfile
pipeline {
    agent {
        docker {
            image 'oven/bun:latest'
        }
    }

    stages {
        stage('Install') {
            steps {
                sh 'bun install'
            }
        }

        stage('Start App') {
            steps {
                sh 'bun run start &'
                sh 'sleep 5'
            }
        }

        stage('Create Tunnel') {
            steps {
                sh 'bun add -g localtunnels'
                sh "localtunnel start --from localhost:3000 --subdomain jenkins-${BUILD_NUMBER} &"
                sh 'sleep 5'
            }
        }

        stage('E2E Tests') {
            environment {
                BASE_URL = "https://jenkins-${BUILD_NUMBER}.tunnels.dev"
            }
            steps {
                sh 'bun run test:e2e'
            }
        }
    }

    post {
        always {
            sh 'pkill -f localtunnel || true'
        }
    }
}
```

## Programmatic CI Integration

### Node.js Script for CI

```typescript
// scripts/ci-tunnel.ts
import { TunnelClient } from 'localtunnels'
import { spawn } from 'child_process'

async function main() {
  // Start your application
  const app = spawn('bun', ['run', 'start'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '3000' },
  })

  // Wait for app to start
  await new Promise(resolve => setTimeout(resolve, 5000))

  // Create tunnel
  const subdomain = `ci-${process.env.CI_BUILD_ID || Date.now()}`
  const client = new TunnelClient({
    localPort: 3000,
    subdomain,
    verbose: true,
  })

  await client.connect()
  const tunnelUrl = `https://${subdomain}.tunnels.dev`

  console.log(`Tunnel URL: ${tunnelUrl}`)

  // Export for other steps
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('fs')
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `tunnel_url=${tunnelUrl}\n`)
  }

  // Keep alive until tests complete
  process.on('SIGTERM', () => {
    client.disconnect()
    app.kill()
    process.exit(0)
  })
}

main().catch(console.error)
```

### Test Helper

```typescript
// test/helpers/tunnel.ts
import { TunnelClient } from 'localtunnels'

let tunnelClient: TunnelClient | null = null

export async function setupTunnel(port: number = 3000): Promise<string> {
  const subdomain = `test-${Date.now()}`

  tunnelClient = new TunnelClient({
    localPort: port,
    subdomain,
  })

  await tunnelClient.connect()
  return `https://${subdomain}.tunnels.dev`
}

export function teardownTunnel(): void {
  tunnelClient?.disconnect()
  tunnelClient = null
}

// Usage in tests
beforeAll(async () => {
  process.env.TUNNEL_URL = await setupTunnel(3000)
})

afterAll(() => {
  teardownTunnel()
})
```

## Self-Hosted CI Integration

For self-hosted tunnel servers:

```yaml
# .github/workflows/self-hosted.yml
name: Self-Hosted Tunnel Tests

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Create tunnel to self-hosted server
        run: |
          bun add -g localtunnels
          localtunnel start \
            --from localhost:3000 \
            --host tunnels.yourcompany.com \
            --port 443 \
            --secure \
            --subdomain ci-${{ github.run_id }} &
          sleep 5
        env:
          TUNNEL_TOKEN: ${{ secrets.TUNNEL_TOKEN }}

      - name: Run tests
        run: bun run test:e2e
        env:
          BASE_URL: https://ci-${{ github.run_id }}.tunnels.yourcompany.com
```

## Best Practices

### Unique Subdomains

Always use unique subdomains to avoid conflicts:

```yaml
# Use build/run IDs
SUBDOMAIN: ci-${{ github.run_id }}
SUBDOMAIN: build-${BUILD_NUMBER}
SUBDOMAIN: mr-${CI_MERGE_REQUEST_IID}
```

### Cleanup

Always clean up tunnels after tests:

```yaml
post:
  always:
    - name: Cleanup tunnel
      run: pkill -f localtunnel || true
```

### Timeouts

Set appropriate timeouts:

```yaml
- name: Run tests with timeout
  timeout-minutes: 10
  run: bun run test:e2e
```

### Security

Never commit tunnel credentials:

```yaml
env:
  TUNNEL_TOKEN: ${{ secrets.TUNNEL_TOKEN }}
```

## Troubleshooting

### Tunnel Not Starting

```yaml
- name: Start tunnel with retry
  run: |
    for i in 1 2 3; do
      localtunnel start --from localhost:3000 --subdomain test-${{ github.run_id }} &
      sleep 5
      curl -s https://test-${{ github.run_id }}.tunnels.dev/health && break
      echo "Retry $i..."
    done
```

### Connection Timeouts

```yaml
- name: Increase timeouts
  run: |
    localtunnel start \
      --from localhost:3000 \
      --subdomain test \
      --timeout 60000 &
```

## Next Steps

- Review [Server Setup](/advanced/server-setup) for self-hosted CI
- Optimize [Performance](/advanced/performance) for faster CI runs
- Explore [Configuration](/advanced/configuration) options
