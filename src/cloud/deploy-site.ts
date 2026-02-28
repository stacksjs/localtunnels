/**
 * LocalTunnels Marketing Site Deployment
 *
 * Uses ts-cloud to deploy a static site (bunpress output) to S3+CloudFront
 * with Porkbun DNS for the root domain. After deployment, also ensures
 * the `api.localtunnel.dev` A record points to the tunnel EC2 server.
 */

export interface SiteDeployConfig {
  /**
   * AWS region
   * @default 'us-east-1'
   */
  region?: string

  /**
   * Domain for the marketing site
   * @default 'localtunnel.dev'
   */
  domain?: string

  /**
   * Source directory (bunpress build output)
   * @default './dist/.bunpress'
   */
  sourceDir?: string

  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean

  /**
   * Porkbun API key (falls back to PORKBUN_API_KEY env)
   */
  porkbunApiKey?: string

  /**
   * Porkbun secret key (falls back to PORKBUN_SECRET_KEY env)
   */
  porkbunSecretKey?: string
}

export interface SiteDeployResult {
  success: boolean
  bucket: string
  distributionId?: string
  distributionDomain?: string
  domain: string
  filesUploaded?: number
  message: string
}

/**
 * Deploy the marketing/docs site to S3+CloudFront with Porkbun DNS.
 */
export async function deploySite(config: SiteDeployConfig = {}): Promise<SiteDeployResult> {
  let deployStaticSiteWithExternalDnsFull: any

  try {
    const tsCloud = await import('@stacksjs/ts-cloud')
    deployStaticSiteWithExternalDnsFull = tsCloud.deployStaticSiteWithExternalDnsFull
  }
  catch {
    throw new Error(
      '@stacksjs/ts-cloud package is required for site deployment.\n'
      + 'Install it with: bun add @stacksjs/ts-cloud',
    )
  }

  const region = config.region || 'us-east-1'
  const domain = config.domain || 'localtunnel.dev'
  const sourceDir = config.sourceDir || './dist/.bunpress'
  const verbose = config.verbose || false
  const porkbunApiKey = config.porkbunApiKey || process.env.PORKBUN_API_KEY || ''
  const porkbunSecretKey = config.porkbunSecretKey || process.env.PORKBUN_SECRET_KEY || process.env.PORKBUN_SECRET_API_KEY || ''

  if (!porkbunApiKey || !porkbunSecretKey) {
    throw new Error(
      'Porkbun API credentials are required for site deployment.\n'
      + 'Set PORKBUN_API_KEY and PORKBUN_SECRET_KEY environment variables.',
    )
  }

  const log = (msg: string) => {
    if (verbose)
      console.log(`[deploy:site] ${msg}`)
  }

  log(`Deploying static site to ${domain}...`)
  log(`Source directory: ${sourceDir}`)
  log(`Region: ${region}`)

  // Stage the deploy directory:
  //   /index.html          → marketing landing page (src/ui/marketing/index.stx)
  //   /docs/**             → bunpress docs output
  const { mkdtemp, cp, rm, readdir, readFile, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const stageDir = await mkdtemp(join(tmpdir(), 'localtunnel-site-'))
  log(`Staging directory: ${stageDir}`)

  try {
    // Copy bunpress docs output into /docs/ subdirectory
    const docsDir = join(stageDir, 'docs')
    await cp(sourceDir, docsDir, { recursive: true })
    log(`Copied docs to ${docsDir}`)

    // Rewrite internal links in docs HTML so they work under /docs/
    // bunpress generates root-relative links like href="/intro" which need
    // to become href="/docs/intro" when served from the /docs/ subdirectory
    async function rewriteDocsLinks(dir: string): Promise<number> {
      let count = 0
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          count += await rewriteDocsLinks(fullPath)
        }
        else if (entry.name.endsWith('.html')) {
          let html = await readFile(fullPath, 'utf-8')
          // Rewrite href="/..." to href="/docs/..." (skip external and anchor links)
          // Also rewrite src="/..." for any root-relative assets
          const rewritten = html
            .replace(/href="\/(?!docs\/|https?:|\/)/g, 'href="/docs/')
            .replace(/src="\/(?!docs\/|https?:|\/)/g, 'src="/docs/')
          if (rewritten !== html) {
            await writeFile(fullPath, rewritten)
            count++
          }
        }
      }
      return count
    }
    const rewrittenCount = await rewriteDocsLinks(docsDir)
    log(`Rewrote links in ${rewrittenCount} HTML files`)

    // Copy marketing landing page as root index.html
    const marketingPath = new URL('../ui/marketing/index.stx', import.meta.url).pathname
    const marketingFile = Bun.file(marketingPath)
    if (await marketingFile.exists()) {
      await Bun.write(join(stageDir, 'index.html'), marketingFile)
      log('Copied marketing page as root index.html')
    }
    else {
      log('Warning: Marketing page not found at src/ui/marketing/index.stx — using docs index as root')
      const docsIndex = Bun.file(join(docsDir, 'index.html'))
      if (await docsIndex.exists()) {
        await Bun.write(join(stageDir, 'index.html'), docsIndex)
      }
    }

    const result = await deployStaticSiteWithExternalDnsFull({
      siteName: 'localtunnel-site',
      region,
      domain,
      bucket: 'localtunnels-site',
      sourceDir: stageDir,
      cleanBucket: true,
      dnsProvider: {
        provider: 'porkbun',
        apiKey: porkbunApiKey,
        secretKey: porkbunSecretKey,
      },
      tags: {
        Project: 'localtunnels',
      },
      onProgress: verbose
        ? (stage: string, detail?: string) => {
            log(`${stage}${detail ? `: ${detail}` : ''}`)
          }
        : undefined,
    })

    if (!result.success) {
      throw new Error(`Site deployment failed: ${result.message}`)
    }

    log('Site deployment complete!')
    log(`Distribution: ${result.distributionDomain}`)
    log(`Bucket: ${result.bucket}`)
    if (result.filesUploaded) {
      log(`Files uploaded: ${result.filesUploaded}`)
    }

    // Ensure api.domain A record points to the tunnel EC2 server.
    try {
      const tsCloud2 = await import('@stacksjs/ts-cloud')
      const PorkbunProvider = tsCloud2.PorkbunProvider
      if (PorkbunProvider) {
        const porkbun = new PorkbunProvider(porkbunApiKey, porkbunSecretKey)
        const allRecords = await porkbun.listRecords(domain)
        const wildcardA = allRecords.records?.find((r: any) => {
          const name = r.name?.replace(/\.$/, '') || ''
          return r.type === 'A' && (name === `*.${domain}` || name === '*')
        })

        if (wildcardA?.content) {
          const ec2Ip = wildcardA.content
          log(`Found tunnel server IP from wildcard: ${ec2Ip}`)
          const apiResult = await porkbun.upsertRecord(domain, {
            name: `api.${domain}`,
            type: 'A',
            content: ec2Ip,
            ttl: 300,
          })
          if (apiResult.success) {
            log(`Set A record: api.${domain} -> ${ec2Ip}`)
          }
          else {
            log(`Warning: Could not set api A record: ${apiResult.message}`)
          }
        }
        else {
          log('Note: No wildcard A record found — skipping api subdomain A record creation')
        }
      }
    }
    catch (err) {
      log(`Note: Could not set api A record (non-fatal): ${err instanceof Error ? err.message : err}`)
    }

    return {
      success: true,
      bucket: result.bucket,
      distributionId: result.distributionId,
      distributionDomain: result.distributionDomain,
      domain,
      filesUploaded: result.filesUploaded,
      message: result.message,
    }
  }
  finally {
    // Clean up staging directory
    await rm(stageDir, { recursive: true, force: true }).catch(() => {})
    log('Cleaned up staging directory')
  }
}

/**
 * Destroy the marketing site infrastructure (S3 bucket + CloudFront distribution).
 */
export async function destroySite(config: Pick<SiteDeployConfig, 'region' | 'verbose'> = {}): Promise<void> {
  let deleteStaticSite: any

  try {
    const tsCloud = await import('@stacksjs/ts-cloud')
    deleteStaticSite = tsCloud.deleteStaticSite
  }
  catch {
    throw new Error(
      '@stacksjs/ts-cloud package is required.\n'
      + 'Install it with: bun add @stacksjs/ts-cloud',
    )
  }

  const region = config.region || 'us-east-1'
  const verbose = config.verbose || false

  const log = (msg: string) => {
    if (verbose)
      console.log(`[destroy:site] ${msg}`)
  }

  log('Destroying static site infrastructure...')

  await deleteStaticSite({
    stackName: 'localtunnel-site',
    region,
  })

  log('Site infrastructure destroyed')
}
