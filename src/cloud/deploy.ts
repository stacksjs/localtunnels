/**
 * LocalTunnels Cloud Deployment
 * Uses ts-cloud for AWS infrastructure deployment
 *
 * Deploys a TunnelServer directly on EC2 with:
 * - EC2 instance running Bun + localtunnels
 * - Security group for HTTP/HTTPS/SSH
 * - Elastic IP for stable addressing
 * - Optional Route53 wildcard DNS
 */

export interface TunnelDeployConfig {
  /**
   * AWS region to deploy to
   * @default 'us-east-1'
   */
  region?: string

  /**
   * Prefix for all resource names
   * @default 'localtunnel'
   */
  prefix?: string

  /**
   * Domain name for the tunnel service (e.g. 'localtunnel.dev')
   * When provided, Route53 DNS records will be created
   */
  domain?: string

  /**
   * Route53 hosted zone ID (auto-detected from domain if not provided)
   */
  hostedZoneId?: string

  /**
   * EC2 instance type
   * @default 't3.micro'
   */
  instanceType?: string

  /**
   * EC2 key pair name for SSH access
   */
  keyName?: string

  /**
   * Enable verbose logging during deployment
   * @default false
   */
  verbose?: boolean

  /**
   * Enable SSL (use HTTPS/WSS)
   * @default false
   */
  enableSsl?: boolean

  /**
   * Porkbun API key for DNS-01 TLS challenge (required when enableSsl is true)
   * Falls back to PORKBUN_API_KEY environment variable
   */
  porkbunApiKey?: string

  /**
   * Porkbun secret API key for DNS-01 TLS challenge (required when enableSsl is true)
   * Falls back to PORKBUN_SECRET_KEY or PORKBUN_SECRET_API_KEY environment variable
   */
  porkbunSecretKey?: string
}

export interface TunnelDeployResult {
  /**
   * Public IP address (Elastic IP)
   */
  publicIp: string

  /**
   * EC2 instance ID
   */
  instanceId: string

  /**
   * Security group ID
   */
  securityGroupId: string

  /**
   * Elastic IP allocation ID
   */
  allocationId: string

  /**
   * HTTP(S) URL for the tunnel server
   */
  serverUrl: string

  /**
   * WebSocket URL for the tunnel server
   */
  wsUrl: string

  /**
   * Domain name (if configured)
   */
  domain?: string

  /**
   * AWS region
   */
  region: string
}

/**
 * Import ts-cloud, handling the case where package.json exports
 * point to src/ (development) but only dist/ exists (published).
 */
async function importTsCloud(): Promise<any> {
  try {
    return await import('@stacksjs/ts-cloud')
  }
  catch {
    // Fallback: resolve package.json location and import from dist/
    const path = await import('node:path')
    const pkgDir = path.dirname(require.resolve('@stacksjs/ts-cloud/package.json'))
    return import(path.join(pkgDir, 'dist/index.js'))
  }
}

/**
 * Deploy the tunnel infrastructure to AWS
 *
 * Launches an EC2 instance running the localtunnels TunnelServer via Bun,
 * assigns an Elastic IP, and optionally sets up Route53 wildcard DNS.
 */
export async function deployTunnelInfrastructure(
  config: TunnelDeployConfig = {},
): Promise<TunnelDeployResult> {
  let EC2Client: any, Route53Client: any, SSMClient: any, PorkbunProvider: any

  try {
    const tsCloud = await importTsCloud()
    EC2Client = tsCloud.EC2Client
    Route53Client = tsCloud.Route53Client
    SSMClient = tsCloud.SSMClient
    PorkbunProvider = tsCloud.PorkbunProvider
  }
  catch {
    throw new Error(
      '@stacksjs/ts-cloud package is required for AWS deployment.\n'
      + 'Install it with: bun add @stacksjs/ts-cloud',
    )
  }

  const region = config.region || 'us-east-1'
  const prefix = config.prefix || 'localtunnel'
  const instanceType = config.instanceType || 't3.micro'
  const verbose = config.verbose || false

  const log = (msg: string) => {
    if (verbose)
      console.log(`[deploy] ${msg}`)
  }

  const ec2 = new EC2Client(region)

  // ============================================
  // Step 1: Find or create VPC with internet access
  // ============================================

  log('Finding VPC with internet access...')

  let vpcId: string | undefined
  let subnetId: string | undefined

  // Strategy: find a VPC that has an internet gateway + a subnet with a
  // route to that IGW. Prefer the default VPC, then any VPC with IGW access.

  const allVpcs = await ec2.describeVpcs()
  const vpcs = allVpcs.Vpcs || []

  // Sort: default VPCs first, then localtunnel-tagged, then others
  vpcs.sort((a, b) => {
    if (a.IsDefault && !b.IsDefault) return -1
    if (!a.IsDefault && b.IsDefault) return 1
    const aProject = a.Tags?.find(t => t.Key === 'Project')?.Value === 'localtunnels'
    const bProject = b.Tags?.find(t => t.Key === 'Project')?.Value === 'localtunnels'
    if (aProject && !bProject) return -1
    if (!aProject && bProject) return 1
    return 0
  })

  for (const vpc of vpcs) {
    const vid = vpc.VpcId!
    const vpcName = vpc.Tags?.find(t => t.Key === 'Name')?.Value || vid
    log(`Checking VPC: ${vpcName} (${vid})...`)

    // Check if VPC has an internet gateway
    const igws = await ec2.describeInternetGateways({
      Filters: [{ Name: 'attachment.vpc-id', Values: [vid] }],
    })
    if (!igws.InternetGateways?.length) {
      log(`  No internet gateway — skipping`)
      continue
    }

    // Find a subnet that has a route to the IGW
    const subnets = await ec2.describeSubnets({
      Filters: [{ Name: 'vpc-id', Values: [vid] }],
    })
    const routeTables = await ec2.describeRouteTables({
      Filters: [{ Name: 'vpc-id', Values: [vid] }],
    })

    // Build a map of subnet -> route table
    let mainRtId: string | undefined
    const subnetToRt: Record<string, string> = {}

    for (const rt of routeTables.RouteTables || []) {
      for (const assoc of rt.Associations || []) {
        if (assoc.Main) {
          mainRtId = rt.RouteTableId
        }
        else if (assoc.SubnetId) {
          subnetToRt[assoc.SubnetId] = rt.RouteTableId!
        }
      }
    }

    // Find a subnet whose route table has an IGW route
    for (const subnet of subnets.Subnets || []) {
      const rtId = subnetToRt[subnet.SubnetId!] || mainRtId
      const rt = (routeTables.RouteTables || []).find(r => r.RouteTableId === rtId)
      const hasIgwRoute = rt?.Routes?.some(r => r.GatewayId?.startsWith('igw-'))

      if (hasIgwRoute) {
        vpcId = vid
        subnetId = subnet.SubnetId
        const sname = subnet.Tags?.find(t => t.Key === 'Name')?.Value || subnet.SubnetId
        log(`  Found public subnet: ${sname} (${subnet.SubnetId})`)
        break
      }
    }

    if (vpcId) break
  }

  // If no VPC with internet access found, create one
  if (!vpcId) {
    log('No VPC with internet access found, creating one...')
    const vpcResult = await ec2.createVpc({
      CidrBlock: '10.0.0.0/16',
      TagSpecifications: [{
        ResourceType: 'vpc',
        Tags: [
          { Key: 'Name', Value: `${prefix}-tunnel-vpc` },
          { Key: 'Project', Value: 'localtunnels' },
        ],
      }],
    })
    vpcId = vpcResult.Vpc?.VpcId
    if (!vpcId) {
      throw new Error('Failed to create VPC')
    }
    log(`Created VPC: ${vpcId}`)

    // Create and attach an internet gateway
    log('Creating internet gateway...')
    const igwResult = await ec2.createInternetGateway({
      TagSpecifications: [{
        ResourceType: 'internet-gateway',
        Tags: [
          { Key: 'Name', Value: `${prefix}-tunnel-igw` },
          { Key: 'Project', Value: 'localtunnels' },
        ],
      }],
    })
    const igwId = igwResult.InternetGatewayId
    if (igwId) {
      log(`Created internet gateway: ${igwId}`)
      await ec2.attachInternetGateway({
        InternetGatewayId: igwId,
        VpcId: vpcId,
      })
      log('Attached internet gateway to VPC')

      // Add default route to IGW in main route table
      const routeTables = await ec2.describeRouteTables({
        Filters: [
          { Name: 'vpc-id', Values: [vpcId] },
          { Name: 'association.main', Values: ['true'] },
        ],
      })
      const mainRouteTableId = routeTables.RouteTables?.[0]?.RouteTableId
      if (mainRouteTableId) {
        await ec2.createRoute({
          RouteTableId: mainRouteTableId,
          DestinationCidrBlock: '0.0.0.0/0',
          GatewayId: igwId,
        })
        log('Added default route to internet gateway')
      }
    }
    else {
      log('Warning: Could not create internet gateway — instance may not have internet access')
    }
  }

  // Find or create a public subnet in the selected VPC
  if (!subnetId) {
    const existingSubnets = await ec2.describeSubnets({
      Filters: [{ Name: 'vpc-id', Values: [vpcId!] }],
    })
    if (existingSubnets.Subnets?.[0]?.SubnetId) {
      subnetId = existingSubnets.Subnets[0].SubnetId
      log(`Found subnet: ${subnetId} (${existingSubnets.Subnets[0].AvailabilityZone})`)
    }
    else {
      log('Creating subnet...')
      const subnetResult = await ec2.createSubnet({
        VpcId: vpcId!,
        CidrBlock: '10.0.1.0/24',
        AvailabilityZone: `${region}a`,
        TagSpecifications: [{
          ResourceType: 'subnet',
          Tags: [
            { Key: 'Name', Value: `${prefix}-tunnel-subnet` },
            { Key: 'Project', Value: 'localtunnels' },
          ],
        }],
      })
      subnetId = subnetResult.Subnet?.SubnetId
      if (!subnetId) {
        throw new Error('Failed to create subnet')
      }
      log(`Created subnet: ${subnetId}`)

      // Enable auto-assign public IPs
      await ec2.modifySubnetAttribute({
        SubnetId: subnetId,
        MapPublicIpOnLaunch: { Value: true },
      })
      log('Enabled auto-assign public IPs on subnet')
    }
  }

  // ============================================
  // Step 2: Create security group
  // ============================================

  log('Creating security group...')
  const sgName = `${prefix}-tunnel-sg`
  let securityGroupId: string

  try {
    const sgResult = await ec2.createSecurityGroup({
      GroupName: sgName,
      Description: 'Security group for LocalTunnel server',
      VpcId: vpcId!,
      TagSpecifications: [{
        ResourceType: 'security-group',
        Tags: [
          { Key: 'Name', Value: sgName },
          { Key: 'Project', Value: 'localtunnels' },
        ],
      }],
    })
    securityGroupId = sgResult.GroupId!
    log(`Created security group: ${securityGroupId}`)

    // Add ingress rules for SSH, HTTP, HTTPS
    await ec2.authorizeSecurityGroupIngress({
      GroupId: securityGroupId,
      IpPermissions: [
        { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'SSH' }] },
        { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTP' }] },
        { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTPS' }] },
      ],
    })
    log('Added ingress rules for SSH, HTTP, HTTPS')
  }
  catch (error: any) {
    if (error.message?.includes('already exists') || error.code === 'InvalidGroup.Duplicate') {
      const sgs = await ec2.describeSecurityGroups({
        Filters: [
          { Name: 'group-name', Values: [sgName] },
          { Name: 'vpc-id', Values: [vpcId!] },
        ],
      })
      securityGroupId = sgs.SecurityGroups?.[0]?.GroupId!
      if (!securityGroupId) {
        throw new Error(`Security group ${sgName} exists but could not be found`)
      }
      log(`Using existing security group: ${securityGroupId}`)
    }
    else {
      throw error
    }
  }

  // ============================================
  // Step 3: Resolve AMI ID via SSM parameter
  // ============================================

  log('Resolving latest Amazon Linux 2023 AMI...')
  let amiId: string

  try {
    const ssm = new SSMClient(region)
    const ssmResult = await ssm.getParameter({
      Name: '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64',
    })
    amiId = ssmResult.Parameter?.Value
    if (!amiId) {
      throw new Error('SSM parameter returned no AMI value')
    }
    log(`Resolved AMI: ${amiId}`)
  }
  catch (error: any) {
    log(`Warning: Could not resolve AMI via SSM: ${error.message}`)
    throw new Error(
      'Could not resolve latest AMI ID via SSM. '
      + 'Ensure AWS credentials have ssm:GetParameter permission.',
    )
  }

  // ============================================
  // Step 4: Generate user data script
  // ============================================

  // With SSL: Bun serves TLS directly on port 443
  // Without SSL: Bun serves HTTP on port 80
  const internalPort = config.enableSsl ? 443 : 80
  const porkbunApiKey = config.porkbunApiKey || process.env.PORKBUN_API_KEY || ''
  const porkbunSecretKey = config.porkbunSecretKey || process.env.PORKBUN_SECRET_KEY || process.env.PORKBUN_SECRET_API_KEY || ''

  if (config.enableSsl && (!porkbunApiKey || !porkbunSecretKey)) {
    throw new Error(
      'Porkbun API credentials are required for SSL.\n'
      + 'Set PORKBUN_API_KEY and PORKBUN_SECRET_KEY environment variables,\n'
      + 'or pass them via --porkbun-api-key and --porkbun-secret-key.',
    )
  }

  const userData = generateUserData({
    internalPort,
    domain: config.domain,
    enableSsl: config.enableSsl,
    porkbunApiKey,
    porkbunSecretKey,
  })
  log('Generated user data script')

  // ============================================
  // Step 5: Launch EC2 instance
  // ============================================

  log(`Launching ${instanceType} instance...`)

  const runInstancesParams: Record<string, any> = {
    ImageId: amiId,
    InstanceType: instanceType,
    MinCount: 1,
    MaxCount: 1,
    SubnetId: subnetId!,
    SecurityGroupIds: [securityGroupId],
    UserData: btoa(userData),
    TagSpecifications: [{
      ResourceType: 'instance',
      Tags: [
        { Key: 'Name', Value: `${prefix}-tunnel-server` },
        { Key: 'Project', Value: 'localtunnels' },
      ],
    }],
  }

  if (config.keyName) {
    runInstancesParams.KeyName = config.keyName
    log(`Using key pair: ${config.keyName}`)
  }

  const runResult = await ec2.runInstances(runInstancesParams)

  const instanceId = runResult.Instances?.[0]?.InstanceId

  if (!instanceId) {
    log(`RunInstances response: ${JSON.stringify(runResult, null, 2)}`)
    throw new Error('Failed to launch EC2 instance — could not extract instance ID from response')
  }

  log(`Launched instance: ${instanceId}`)

  // ============================================
  // Step 6: Wait for instance to be running
  // ============================================

  // Brief delay for AWS eventual consistency — instance ID may not be
  // immediately findable via DescribeInstances after RunInstances returns
  log('Waiting for instance to be discoverable...')
  await new Promise(resolve => setTimeout(resolve, 5000))

  log('Waiting for instance to reach running state...')
  await ec2.waitForInstanceState(instanceId, 'running', {
    maxWaitMs: 180000,
    pollIntervalMs: 5000,
  })
  log('Instance is running')

  // ============================================
  // Step 7: Allocate and associate Elastic IP
  // ============================================

  let publicIp: string
  let allocationId: string | undefined

  try {
    log('Allocating Elastic IP...')
    const eipResult = await ec2.allocateAddress({
      Domain: 'vpc',
      TagSpecifications: [{
        ResourceType: 'elastic-ip',
        Tags: [
          { Key: 'Name', Value: `${prefix}-tunnel-eip` },
          { Key: 'Project', Value: 'localtunnels' },
        ],
      }],
    })
    allocationId = eipResult.AllocationId!
    publicIp = eipResult.PublicIp!
    log(`Allocated Elastic IP: ${publicIp} (${allocationId})`)

    log('Associating Elastic IP with instance...')
    await ec2.associateAddress({
      AllocationId: allocationId,
      InstanceId: instanceId,
    })
    log('Elastic IP associated')
  }
  catch (error: any) {
    // EIP limit reached — fall back to auto-assigned public IP
    log(`Warning: Could not allocate Elastic IP: ${error.message?.split('<Message>')?.[1]?.split('</Message>')?.[0] || error.message}`)
    log('Falling back to instance auto-assigned public IP...')

    const instanceInfo = await ec2.getInstance(instanceId)
    publicIp = instanceInfo?.PublicIpAddress || ''

    if (!publicIp) {
      throw new Error('Instance has no public IP. Ensure the subnet has MapPublicIpOnLaunch enabled.')
    }
    log(`Using instance public IP: ${publicIp} (note: this IP may change if instance is stopped)`)
  }

  // ============================================
  // Step 8: DNS setup (Porkbun API or Route53)
  // ============================================

  if (config.domain) {
    const porkbunApiKey = config.porkbunApiKey || process.env.PORKBUN_API_KEY || ''
    const porkbunSecretKey = config.porkbunSecretKey || process.env.PORKBUN_SECRET_KEY || process.env.PORKBUN_SECRET_API_KEY || ''

    if (porkbunApiKey && porkbunSecretKey && PorkbunProvider) {
      // Use ts-cloud PorkbunProvider for DNS management
      log(`Setting up Porkbun DNS for ${config.domain}...`)
      try {
        const porkbun = new PorkbunProvider(porkbunApiKey, porkbunSecretKey)

        // Upsert root A record
        const rootResult = await porkbun.upsertRecord(config.domain, {
          name: '',
          type: 'A',
          content: publicIp,
          ttl: 300,
        })
        if (rootResult.success) {
          log(`Set A record: ${config.domain} -> ${publicIp}`)
        }
        else {
          log(`Warning: Could not set root A record: ${rootResult.message}`)
        }

        // Upsert wildcard A record
        const wildResult = await porkbun.upsertRecord(config.domain, {
          name: '*',
          type: 'A',
          content: publicIp,
          ttl: 300,
        })
        if (wildResult.success) {
          log(`Set A record: *.${config.domain} -> ${publicIp}`)
        }
        else {
          log(`Warning: Could not set wildcard A record: ${wildResult.message}`)
        }
      }
      catch (error: any) {
        log(`Warning: Porkbun DNS setup failed: ${error.message}`)
      }
    }
    else {
      // Fallback to Route53
      log(`Setting up Route53 DNS for ${config.domain}...`)
      try {
        const route53 = new Route53Client(region)

        let hostedZoneId = config.hostedZoneId
        if (!hostedZoneId) {
          const zone = await route53.findHostedZoneForDomain(config.domain)
          hostedZoneId = zone?.Id?.replace('/hostedzone/', '')
        }

        if (hostedZoneId) {
          await route53.createARecord({
            HostedZoneId: hostedZoneId,
            Name: config.domain,
            Value: publicIp,
            TTL: 300,
          })
          log(`Created A record: ${config.domain} -> ${publicIp}`)

          await route53.createARecord({
            HostedZoneId: hostedZoneId,
            Name: `*.${config.domain}`,
            Value: publicIp,
            TTL: 300,
          })
          log(`Created A record: *.${config.domain} -> ${publicIp}`)
        }
        else {
          log(`Warning: Could not find Route53 hosted zone for ${config.domain}`)
          log('DNS records were not created. Set up DNS manually or provide --hosted-zone-id.')
        }
      }
      catch (error: any) {
        log(`Warning: Route53 DNS setup failed: ${error.message}`)
        log('The server is deployed but DNS is not configured.')
      }
    }
  }

  // ============================================
  // Done
  // ============================================

  const protocol = config.enableSsl ? 'https' : 'http'
  const wsProtocol = config.enableSsl ? 'wss' : 'ws'
  const serverHost = config.domain || publicIp
  const serverUrl = `${protocol}://${serverHost}`
  const wsUrl = `${wsProtocol}://${serverHost}`

  log('Deployment complete!')

  return {
    publicIp,
    instanceId,
    securityGroupId,
    allocationId: allocationId || '',
    serverUrl,
    wsUrl,
    domain: config.domain,
    region,
  }
}

/**
 * Destroy the tunnel infrastructure
 */
export async function destroyTunnelInfrastructure(
  config: TunnelDeployConfig = {},
): Promise<void> {
  let EC2Client: any, Route53Client: any, PorkbunProviderCls: any

  try {
    const tsCloud = await importTsCloud()
    EC2Client = tsCloud.EC2Client
    Route53Client = tsCloud.Route53Client
    PorkbunProviderCls = tsCloud.PorkbunProvider
  }
  catch {
    throw new Error(
      '@stacksjs/ts-cloud package is required for AWS deployment.\n'
      + 'Install it with: bun add @stacksjs/ts-cloud',
    )
  }

  const region = config.region || 'us-east-1'
  const prefix = config.prefix || 'localtunnel'
  const verbose = config.verbose || false

  const log = (msg: string) => {
    if (verbose)
      console.log(`[destroy] ${msg}`)
  }

  const ec2 = new EC2Client(region)

  // ============================================
  // Step 1: Find instance by tag
  // ============================================

  log('Finding tunnel server instance...')

  const instances = await ec2.describeInstances({
    Filters: [
      { Name: 'tag:Project', Values: ['localtunnels'] },
      { Name: 'tag:Name', Values: [`${prefix}-tunnel-server`] },
      { Name: 'instance-state-name', Values: ['running', 'stopped', 'pending'] },
    ],
  })

  const instance = instances.Reservations?.[0]?.Instances?.[0]
  const instanceId = instance?.InstanceId

  if (!instanceId) {
    log('No tunnel server instance found')
  }
  else {
    log(`Found instance: ${instanceId}`)
  }

  // ============================================
  // Step 2: Find and release Elastic IP
  // ============================================

  log('Finding Elastic IP...')

  const addresses = await ec2.describeAddresses({
    Filters: [
      { Name: 'tag:Project', Values: ['localtunnels'] },
      { Name: 'tag:Name', Values: [`${prefix}-tunnel-eip`] },
    ],
  })

  const address = addresses.Addresses?.[0]
  if (address) {
    log(`Found Elastic IP: ${address.PublicIp} (${address.AllocationId})`)

    // Disassociate if associated
    if (address.AssociationId) {
      log('Disassociating Elastic IP...')
      try {
        await ec2.disassociateAddress(address.AssociationId)
        log('Elastic IP disassociated')
      }
      catch (error: any) {
        log(`Warning: Could not disassociate Elastic IP: ${error.message}`)
      }
    }

    // Release the Elastic IP
    if (address.AllocationId) {
      log('Releasing Elastic IP...')
      try {
        await ec2.releaseAddress(address.AllocationId)
        log('Elastic IP released')
      }
      catch (error: any) {
        log(`Warning: Could not release Elastic IP: ${error.message}`)
      }
    }
  }
  else {
    log('No Elastic IP found')
  }

  // ============================================
  // Step 3: Terminate instance
  // ============================================

  if (instanceId) {
    log('Terminating instance...')
    await ec2.terminateInstances([instanceId])
    log('Waiting for instance to terminate...')
    await ec2.waitForInstanceState(instanceId, 'terminated', {
      maxWaitMs: 120000,
      pollIntervalMs: 5000,
    })
    log('Instance terminated')
  }

  // ============================================
  // Step 4: Delete security group
  // ============================================

  const sgName = `${prefix}-tunnel-sg`
  log(`Finding security group: ${sgName}...`)

  const sgs = await ec2.describeSecurityGroups({
    Filters: [
      { Name: 'group-name', Values: [sgName] },
    ],
  })

  const sg = sgs.SecurityGroups?.[0]
  if (sg?.GroupId) {
    log(`Deleting security group: ${sg.GroupId}...`)
    try {
      await ec2.deleteSecurityGroup(sg.GroupId)
      log('Security group deleted')
    }
    catch (error: any) {
      log(`Warning: Could not delete security group: ${error.message}`)
      log('It may still be in use. Try again in a few minutes after the instance is fully terminated.')
    }
  }
  else {
    log('No security group found')
  }

  // ============================================
  // Step 5: Clean up DNS records (Porkbun or Route53)
  // ============================================

  if (config.domain) {
    const porkbunApiKey = config.porkbunApiKey || process.env.PORKBUN_API_KEY || ''
    const porkbunSecretKey = config.porkbunSecretKey || process.env.PORKBUN_SECRET_KEY || process.env.PORKBUN_SECRET_API_KEY || ''

    if (porkbunApiKey && porkbunSecretKey) {
      log(`Note: Porkbun DNS records for ${config.domain} were not deleted (they point to the now-destroyed instance).`)
      log('Update them manually or they will be updated on next deploy.')
    }
    else {
      log(`Cleaning up Route53 DNS records for ${config.domain}...`)
      try {
        const route53 = new Route53Client(region)

        let hostedZoneId = config.hostedZoneId
        if (!hostedZoneId) {
          const zone = await route53.findHostedZoneForDomain(config.domain)
          hostedZoneId = zone?.Id?.replace('/hostedzone/', '')
        }

        if (hostedZoneId) {
          try {
            await route53.deleteRecord({
              HostedZoneId: hostedZoneId,
              Name: config.domain,
              Type: 'A',
            })
            log(`Deleted A record: ${config.domain}`)
          }
          catch (error: any) {
            log(`Warning: Could not delete A record for ${config.domain}: ${error.message}`)
          }

          try {
            await route53.deleteRecord({
              HostedZoneId: hostedZoneId,
              Name: `*.${config.domain}`,
              Type: 'A',
            })
            log(`Deleted A record: *.${config.domain}`)
          }
          catch (error: any) {
            log(`Warning: Could not delete wildcard A record: ${error.message}`)
          }
        }
        else {
          log(`Warning: Could not find Route53 hosted zone for ${config.domain}`)
        }
      }
      catch (error: any) {
        log(`Warning: DNS cleanup failed: ${error.message}`)
      }
    }
  }

  log('Destruction complete!')
}

/**
 * Generate the EC2 user data script that installs Bun, localtunnels,
 * and sets up a systemd service running the TunnelServer.
 *
 * When SSL is enabled with a domain, uses certbot with the Porkbun DNS
 * plugin to obtain a wildcard Let's Encrypt certificate, then passes
 * the cert/key files directly to TunnelServer's ssl option (Bun's
 * native TLS — no reverse proxy needed).
 */
function generateUserData(opts: {
  internalPort: number
  domain?: string
  enableSsl?: boolean
  porkbunApiKey?: string
  porkbunSecretKey?: string
}): string {
  const { internalPort, domain, enableSsl, porkbunApiKey, porkbunSecretKey } = opts

  // Build the server script based on SSL mode
  const sslLines = enableSsl && domain
    ? [
        '  ssl: {',
        '    key: \'/etc/ssl/localtunnel/privkey.pem\',',
        '    cert: \'/etc/ssl/localtunnel/fullchain.pem\',',
        '  },',
      ]
    : []

  const serverScript = [
    'import { TunnelServer } from \'localtunnels\'',
    '',
    'const server = new TunnelServer({',
    `  port: ${internalPort},`,
    '  host: \'0.0.0.0\',',
    '  verbose: true,',
    ...sslLines,
    '})',
    '',
    'server.on(\'connection\', (info) => {',
    '  console.log(`+ Client connected: ${info.subdomain}`)',
    '})',
    '',
    'server.on(\'disconnection\', (info) => {',
    '  console.log(`- Client disconnected: ${info.subdomain}`)',
    '})',
    '',
    'await server.start()',
    `console.log('LocalTunnel server is running on port ${internalPort}')`,
  ].join('\n')

  const lines = [
    '#!/bin/bash',
    'set -x',
    '',
    '# Set HOME explicitly (cloud-init does not always set it)',
    'export HOME=/root',
    '',
    '# Install Bun',
    'export BUN_INSTALL="/root/.bun"',
    'curl -fsSL https://bun.sh/install | bash',
    'export PATH="$BUN_INSTALL/bin:$PATH"',
    '',
    '# Create app directory',
    'mkdir -p /opt/localtunnel',
    'cd /opt/localtunnel',
    '',
    '# Install localtunnels',
    '/root/.bun/bin/bun init -y',
    '/root/.bun/bin/bun add localtunnels',
    '',
    '# Create server script',
    'cat > server.ts << \'SERVERSCRIPT\'',
    serverScript,
    'SERVERSCRIPT',
    '',
  ]

  // When SSL is enabled, install acme.sh for cert provisioning
  if (enableSsl && domain) {
    lines.push(
      '# Install acme.sh for Let\'s Encrypt certificate provisioning',
      'dnf install -y socat cronie',
      `curl -fsSL https://get.acme.sh | sh -s email=admin@${domain}`,
      '',
      'mkdir -p /etc/ssl/localtunnel',
      '',
      '# Create cert provisioning script (called by systemd before server start)',
      'cat > /opt/localtunnel/provision-certs.sh << \'CERTSCRIPT\'',
      '#!/bin/bash',
      'set -e',
      '',
      'CERT_DIR=/etc/ssl/localtunnel',
      'ACME=/root/.acme.sh/acme.sh',
      '',
      '# Skip if certs already exist and are valid',
      'if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then',
      '  # Check cert is not expired (within 30 days)',
      '  if openssl x509 -checkend 2592000 -noout -in "$CERT_DIR/fullchain.pem" 2>/dev/null; then',
      '    echo "Valid certs already present"',
      '    exit 0',
      '  fi',
      '  echo "Certs exist but expiring soon, renewing..."',
      'fi',
      '',
      'echo "Provisioning SSL certificates..."',
      '',
      '# Issue wildcard cert via Porkbun DNS-01 challenge',
      `$ACME --issue --dns dns_porkbun \\`,
      `  -d '${domain}' \\`,
      `  -d '*.${domain}' \\`,
      `  --server letsencrypt \\`,
      '  --keylength ec-256 \\',
      '  --dnssleep 120 \\',
      '  --log /var/log/acme.sh.log \\',
      '  --force || {',
      '  echo "acme.sh --issue failed, check /var/log/acme.sh.log"',
      '  exit 1',
      '}',
      '',
      '# Install cert to a stable location',
      `$ACME --install-cert -d '${domain}' --ecc \\`,
      '  --key-file $CERT_DIR/privkey.pem \\',
      '  --fullchain-file $CERT_DIR/fullchain.pem \\',
      '  --reloadcmd "systemctl restart localtunnel" || {',
      '  echo "acme.sh --install-cert failed"',
      '  exit 1',
      '}',
      '',
      'echo "SSL certificates provisioned successfully"',
      'CERTSCRIPT',
      'chmod +x /opt/localtunnel/provision-certs.sh',
      '',
    )
  }

  // Create systemd service with cert provisioning as ExecStartPre
  if (enableSsl && domain) {
    lines.push(
      '# Create tunnel server service with cert provisioning',
      'cat > /etc/systemd/system/localtunnel.service << \'SERVICEUNIT\'',
      '[Unit]',
      'Description=LocalTunnel Server',
      'After=network-online.target',
      'Wants=network-online.target',
      '',
      '[Service]',
      'Type=simple',
      'WorkingDirectory=/opt/localtunnel',
      'Environment=BUN_INSTALL=/root/.bun',
      'Environment=PATH=/root/.acme.sh:/root/.bun/bin:/usr/local/bin:/usr/bin:/bin',
      `Environment=PORKBUN_API_KEY=${porkbunApiKey}`,
      `Environment=PORKBUN_SECRET_API_KEY=${porkbunSecretKey}`,
      'TimeoutStartSec=600',
      'ExecStartPre=/opt/localtunnel/provision-certs.sh',
      'ExecStart=/root/.bun/bin/bun run server.ts',
      'Restart=always',
      'RestartSec=30',
      'StandardOutput=journal',
      'StandardError=journal',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'SERVICEUNIT',
      '',
      'systemctl daemon-reload',
      'systemctl enable localtunnel',
      'systemctl start localtunnel',
      '',
    )
  }
  else {
    // No SSL — single service, no cert dependency
    lines.push(
      '# Create systemd service for localtunnel',
      'cat > /etc/systemd/system/localtunnel.service << \'SERVICEUNIT\'',
      '[Unit]',
      'Description=LocalTunnel Server',
      'After=network.target',
      '',
      '[Service]',
      'Type=simple',
      'WorkingDirectory=/opt/localtunnel',
      'Environment=BUN_INSTALL=/root/.bun',
      'Environment=PATH=/root/.bun/bin:/usr/local/bin:/usr/bin:/bin',
      'ExecStart=/root/.bun/bin/bun run server.ts',
      'Restart=always',
      'RestartSec=5',
      'StandardOutput=journal',
      'StandardError=journal',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'SERVICEUNIT',
      '',
      'systemctl daemon-reload',
      'systemctl enable localtunnel',
      'systemctl start localtunnel',
      '',
    )
  }

  // acme.sh installs its own cron job for auto-renewal

  return lines.join('\n')
}
